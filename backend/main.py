import os
import time
import logging
from typing import List, Dict, Any, Optional
import numpy as np
import requests
import joblib
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("HeliosForecast")

# Initialize FastAPI application
app = FastAPI(
    title="HeliosForecast Backend API",
    description="Provides 7-day hourly solar yield prediction based on weather forecasts",
    version="1.0.0"
)

# Configure CORS Middleware
# Allow local origins by default, but support environment configuration for production
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

# Load additional origins from environment
env_origins = os.getenv("ALLOWED_ORIGINS", "")
if env_origins:
    origins.extend([o.strip() for o in env_origins.split(",") if o.strip()])

# Render deployments can enable wildcard CORS for ease of access
allow_all_origins = os.getenv("ALLOW_ALL_ORIGINS", "true").lower() == "true"

if allow_all_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,  # Must be False for wildcard * origins in Starlette
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Load Machine Learning Model
MODEL_PATH = os.path.join(os.path.dirname(__file__), "solar_model.pkl")
solar_model = None

try:
    if os.path.exists(MODEL_PATH):
        solar_model = joblib.load(MODEL_PATH)
        logger.info(f"Successfully loaded machine learning model from '{MODEL_PATH}'")
    else:
        logger.warning(f"Model file '{MODEL_PATH}' not found. Falling back to physics-based formula.")
except Exception as e:
    logger.error(f"Failed to load solar model from '{MODEL_PATH}': {e}. Using physics-based fallback.")
    solar_model = None


class ForecastItem(BaseModel):
    time: str
    temperature: float
    cloudCover: float
    radiation: float
    predictedYieldKw: float


# In-memory weather cache to prevent 429 rate limit errors
# Key: (round(lat, 2), round(lon, 2)), approx. 1km coordinate resolution
# Value: {"timestamp": float, "data": dict}
WEATHER_CACHE = {}
CACHE_TTL_SECONDS = 1800  # 30 minutes cache duration

# Visual Crossing API Key (Loaded from environment variables)
VISUAL_CROSSING_API_KEY = os.getenv("VISUAL_CROSSING_API_KEY")


def fetch_from_visual_crossing(lat: float, lon: float, api_key: str) -> dict:
    """
    Fetch 7-day hourly forecast from Visual Crossing Weather API and format
    it to match Open-Meteo's standardized output structure.
    """
    url = f"https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/{lat},{lon}/next7days"
    params = {
        "unitGroup": "metric",
        "include": "hours",
        "key": api_key,
        "contentType": "json"
    }
    
    logger.info(f"Querying Visual Crossing API for Lat: {lat}, Lon: {lon} as fallback.")
    response = requests.get(url, params=params, timeout=12)
    response.raise_for_status()
    data = response.json()
    
    times = []
    temps = []
    clouds = []
    radiations = []
    
    for day in data.get("days", []):
        day_date = day.get("datetime")  # e.g., "2026-06-08"
        for hour in day.get("hours", []):
            hour_time = hour.get("datetime")  # e.g., "13:00:00"
            combined_time = f"{day_date}T{hour_time[:5]}"
            times.append(combined_time)
            
            temps.append(float(hour.get("temp", 0.0)))
            clouds.append(float(hour.get("cloudcover", 0.0)))
            radiations.append(float(hour.get("solarradiation", 0.0)))
            
    return {
        "hourly": {
            "time": times,
            "temperature_2m": temps,
            "cloud_cover": clouds,
            "shortwave_radiation": radiations
        }
    }


@app.get("/")
def read_root():
    """
    Root endpoint for Render health checks.
    """
    return {
        "status": "healthy",
        "service": "HeliosForecast API",
        "fallback_mode": solar_model is None,
        "visual_crossing_configured": VISUAL_CROSSING_API_KEY is not None
    }


@app.get("/api/forecast", response_model=List[ForecastItem])
def get_solar_forecast(
    lat: float = Query(..., description="Latitude of the location"),
    lon: float = Query(..., description="Longitude of the location"),
    system_capacity_kw: float = Query(5.0, description="Installed solar system capacity in kW", alias="system_capacity_kw")
):
    """
    Fetch weather forecasts from Open-Meteo (or Visual Crossing fallback) 
    and predict hourly solar yield for 7 days.
    """
    logger.info(f"Received forecast request for Lat: {lat}, Lon: {lon}, Capacity: {system_capacity_kw}kW")
    
    # 1. Manage caching to avoid Open-Meteo 429 Too Many Requests errors
    # Group coordinates by rounding to 2 decimal places (roughly 1.1km resolution)
    cache_key = (round(lat, 2), round(lon, 2))
    current_time = time.time()
    
    cached_entry = WEATHER_CACHE.get(cache_key)
    weather_data = None
    
    # Check if we have a fresh cache entry
    if cached_entry and (current_time - cached_entry["timestamp"] < CACHE_TTL_SECONDS):
        logger.info(f"Cache hit for coordinates {cache_key}. Using cached forecast.")
        weather_data = cached_entry["data"]
        
    if not weather_data:
        # Step A: Attempt primary fetch from Open-Meteo
        open_meteo_url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m,cloud_cover,shortwave_radiation",
            "timezone": "auto"
        }
        
        try:
            logger.info(f"Cache miss for coordinates {cache_key}. Querying Open-Meteo API.")
            response = requests.get(open_meteo_url, params=params, timeout=10)
            response.raise_for_status()
            weather_data = response.json()
            
            # Save to cache
            WEATHER_CACHE[cache_key] = {
                "timestamp": current_time,
                "data": weather_data
            }
        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching data from Open-Meteo: {e}")
            
            # Step B: Fall back to Visual Crossing if API key is configured
            if VISUAL_CROSSING_API_KEY:
                try:
                    logger.info("Open-Meteo request failed. Attempting Visual Crossing fallback...")
                    weather_data = fetch_from_visual_crossing(lat, lon, VISUAL_CROSSING_API_KEY)
                    
                    # Save parsed Visual Crossing data to cache
                    WEATHER_CACHE[cache_key] = {
                        "timestamp": current_time,
                        "data": weather_data
                    }
                    logger.info("Successfully fetched and cached forecast from Visual Crossing fallback.")
                except Exception as vc_err:
                    logger.error(f"Visual Crossing fallback failed: {vc_err}")
            
            # Step C: Fall back to expired cache entry if both APIs failed
            if not weather_data:
                if cached_entry:
                    logger.warning(f"Serving expired cached weather forecast for {cache_key} due to API errors.")
                    weather_data = cached_entry["data"]
                else:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Weather providers failed. Open-Meteo: {str(e)}."
                    )
    
    # Validate the structure of weather data
    if "hourly" not in weather_data:
        logger.error("Invalid response format received from Open-Meteo")
        raise HTTPException(
            status_code=502,
            detail="Invalid response from weather provider."
        )
    
    hourly = weather_data["hourly"]
    times = hourly.get("time", [])
    temps = hourly.get("temperature_2m", [])
    clouds = hourly.get("cloud_cover", [])
    radiations = hourly.get("shortwave_radiation", [])
    
    # Verify all arrays are equal length
    if not (len(times) == len(temps) == len(clouds) == len(radiations)):
        logger.error("Mismatch in hourly array dimensions from Open-Meteo")
        raise HTTPException(
            status_code=502,
            detail="Incomplete weather dataset returned."
        )
    
    # Pre-allocate predicted yield list
    forecast_results = []
    
    # Use local reference to avoid UnboundLocalError and prevent global mutations
    current_model = solar_model
    model_prediction_successful = False
    predicted_yields = []
    
    # Prepare features for the ML model if available
    if current_model is not None:
        try:
            # We assume model is trained on [temperature_2m, cloud_cover, shortwave_radiation]
            # Construct feature array
            features = np.column_stack((temps, clouds, radiations))
            
            # Predict yield
            ml_predictions = current_model.predict(features)
            
            # Post-process predictions:
            # Scale by system capacity (assuming the baseline model is normalized for 1 kW capacity)
            # and ensure no negative outputs (e.g. due to sensor noise or model fitting at night)
            predicted_yields = [max(0.0, float(pred * system_capacity_kw)) for pred in ml_predictions]
            
            logger.info("Using machine learning model for solar yield prediction")
            model_prediction_successful = True
            
        except Exception as e:
            logger.error(f"Error executing ML model prediction: {e}. Falling back to physics formula.")
            model_prediction_successful = False
            
    # Fallback to mathematical simulation if model is not loaded or fails
    if not model_prediction_successful:
        logger.info("Using mathematical fallback formula for solar yield prediction")
        predicted_yields = []
        for temp, cloud, radiation in zip(temps, clouds, radiations):
            # Mathematical Solar Yield Formulation:
            # predicted_kw = capacity * (radiation / 1000) * (0.20 * (1 - max(0, (temp - 25) * 0.004))) * (1 - (cloudcover / 100 * 0.75))
            
            # Efficiency losses due to temperature: solar panels operate less efficiently above 25 C
            temp_derating = 0.20 * (1.0 - max(0.0, (temp - 25.0) * 0.004))
            
            # Efficiency losses due to clouds: clouds block direct sunlight
            cloud_derating = 1.0 - (cloud / 100.0 * 0.75)
            
            # Solar radiation scaling relative to standard testing conditions (1000 W/m2)
            radiation_ratio = radiation / 1000.0
            
            # Compute predicted solar yield in kW
            yield_kw = system_capacity_kw * radiation_ratio * temp_derating * cloud_derating
            
            # Ensure predicted yield is not negative (e.g. at night, shortwave_radiation should be 0)
            yield_kw = max(0.0, yield_kw)
            predicted_yields.append(yield_kw)
            
    # Build response JSON list
    for i in range(len(times)):
        forecast_results.append(
            ForecastItem(
                time=times[i],
                temperature=temps[i],
                cloudCover=clouds[i],
                radiation=radiations[i],
                predictedYieldKw=round(predicted_yields[i], 3)
            )
        )
        
    return forecast_results


if __name__ == "__main__":
    import uvicorn
    # Start the server
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
