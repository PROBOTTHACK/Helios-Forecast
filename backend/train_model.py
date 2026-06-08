import os
import numpy as np
import joblib
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, r2_score

def generate_synthetic_data(num_samples=10000):
    """
    Generate synthetic weather variables and solar output data.
    Features:
    - Temperature (C): ranging from -5 to 45
    - Cloud Cover (%): ranging from 0 to 100
    - Shortwave Radiation (W/m2): ranging from 0 to 1100
    """
    np.random.seed(42)
    
    # 1. Simulate features
    # Temperature: Gaussian centered at 22C
    temperature = np.random.normal(22, 10, num_samples)
    temperature = np.clip(temperature, -10, 50)
    
    # Cloud Cover: Uniform distribution between 0 and 100%
    cloud_cover = np.random.uniform(0, 100, num_samples)
    
    # Shortwave Radiation: Dependent on cloud cover, with daytime/nighttime distribution
    # Half the day is night (radiation = 0)
    is_daylight = np.random.choice([0, 1], size=num_samples, p=[0.4, 0.6])
    
    base_radiation = np.random.uniform(200, 1050, num_samples)
    # Cloud cover blocks radiation
    radiation = base_radiation * (1.0 - (cloud_cover / 100.0 * 0.7)) * is_daylight
    radiation = np.clip(radiation, 0, 1100)
    
    # 2. Simulate target solar yield (kW) normalized to a 1.0 kW system capacity baseline
    # (Since main.py scales the model prediction by the system_capacity_kw parameter)
    normalized_capacity = 1.0
    
    # Efficiency factors
    temp_derating = 0.20 * (1.0 - np.maximum(0.0, (temperature - 25.0) * 0.004))
    cloud_derating = 1.0 - (cloud_cover / 100.0 * 0.75)
    radiation_ratio = radiation / 1000.0
    
    # Math base yield
    base_yield = normalized_capacity * radiation_ratio * temp_derating * cloud_derating
    base_yield = np.maximum(0.0, base_yield)
    
    # Add Gaussian noise to represent real-world sensor/shading variations (e.g. dust, inverter losses)
    noise = np.random.normal(0, 0.015, num_samples)
    yield_kw = base_yield + noise
    # Ensure yield remains physical (>= 0 and 0 at night)
    yield_kw = np.where(radiation == 0, 0.0, np.maximum(0.0, yield_kw))
    
    # Package into feature matrix (X) and target array (y)
    X = np.column_stack((temperature, cloud_cover, radiation))
    y = yield_kw
    
    return X, y

def train_and_save_model():
    print("Generating simulated weather and solar yield dataset...")
    X, y = generate_synthetic_data()
    
    # Split into train/test sets
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    print(f"Training dataset size: {X_train.shape[0]} samples")
    print("Training RandomForestRegressor model...")
    
    # Fit a Random Forest model
    model = RandomForestRegressor(
        n_estimators=100,
        max_depth=12,
        min_samples_split=5,
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train, y_train)
    
    # Evaluate model
    y_pred = model.predict(X_test)
    mse = mean_squared_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)
    
    print("\nModel Evaluation Metrics (Test Set):")
    print(f"Mean Squared Error (MSE): {mse:.6f}")
    print(f"R-squared (R2 Score): {r2:.4f} ({r2 * 100:.2f}%)")
    
    # Save the model file
    output_path = os.path.join(os.path.dirname(__file__), "solar_model.pkl")
    print(f"\nSaving model to: {output_path}")
    joblib.dump(model, output_path)
    print("Model saved successfully!")

if __name__ == "__main__":
    train_and_save_model()
