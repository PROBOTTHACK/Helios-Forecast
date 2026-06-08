import React, { useState, useEffect, useMemo } from 'react';
import { 
  Sun, 
  Zap, 
  Thermometer, 
  Cloud, 
  MapPin, 
  RotateCw, 
  AlertCircle, 
  Calendar, 
  TrendingUp, 
  Gauge, 
  Info,
  Maximize2,
  Minimize2,
  Compass
} from 'lucide-react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

// API Endpoint configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/forecast';

// Sun-drenched location presets for quick testing and onboarding
const LOCATION_PRESETS = [
  { name: 'Phoenix, USA (Desert Sun)', lat: 33.4484, lon: -112.0740, capacity: 5.0 },
  { name: 'Los Angeles, USA (Coastal)', lat: 34.0522, lon: -118.2437, capacity: 5.0 },
  { name: 'London, UK (Temperate)', lat: 51.5074, lon: -0.1278, capacity: 5.0 },
  { name: 'Sydney, Australia (Southern)', lat: -33.8688, lon: 151.2093, capacity: 5.0 },
];

export default function App() {
  // State for coordinates and system capacity input
  const [lat, setLat] = useState('33.4484'); // Phoenix, AZ default
  const [lon, setLon] = useState('-112.0740');
  const [capacity, setCapacity] = useState('5.0');
  
  // Dashboard states
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Selected day index for the 24h daylight correlation line-chart (0 to 6)
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);

  // Fetch forecast data from FastAPI backend
  const fetchForecast = async (targetLat, targetLon, targetCapacity) => {
    setIsLoading(true);
    setError(null);
    try {
      const latitude = parseFloat(targetLat || lat);
      const longitude = parseFloat(targetLon || lon);
      const sysCapacity = parseFloat(targetCapacity || capacity);

      if (isNaN(latitude) || latitude < -90 || latitude > 90) {
        throw new Error('Latitude must be a valid number between -90 and 90.');
      }
      if (isNaN(longitude) || longitude < -180 || longitude > 180) {
        throw new Error('Longitude must be a valid number between -180 and 180.');
      }
      if (isNaN(sysCapacity) || sysCapacity <= 0) {
        throw new Error('System Capacity must be a positive number.');
      }

      const response = await fetch(
        `${API_BASE_URL}?lat=${latitude}&lon=${longitude}&system_capacity_kw=${sysCapacity}`
      );
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Server returned error status: ${response.status}`);
      }
      
      const json = await response.json();
      setData(json);
    } catch (err) {
      console.error(err);
      setError(err.message || 'An unexpected error occurred while loading forecast data.');
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchForecast();
  }, []);

  // Handle setting a preset location
  const handlePresetSelect = (preset) => {
    setLat(preset.lat.toFixed(4));
    setLon(preset.lon.toFixed(4));
    setCapacity(preset.capacity.toFixed(1));
    fetchForecast(preset.lat, preset.lon, preset.capacity);
  };

  // Parse and group the 168 data points into 7 individual days
  const groupedDays = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    const days = [];
    for (let i = 0; i < data.length; i += 24) {
      const dayData = data.slice(i, i + 24);
      if (dayData.length > 0) {
        const dateObj = new Date(dayData[0].time);
        const dayLabel = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const dayLongLabel = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        
        days.push({
          label: dayLabel,
          longLabel: dayLongLabel,
          index: i / 24,
          data: dayData
        });
      }
    }
    return days;
  }, [data]);

  // Compute KPI Summary Cards values dynamically
  const kpis = useMemo(() => {
    if (!data || data.length === 0) {
      return { maxYield: 0, avgRadiation: 0, avgTemp: 0 };
    }
    
    // Max yield in kW
    const maxYield = Math.max(...data.map(item => item.predictedYieldKw));
    
    // Average shortwave radiation in W/m² (sum / length)
    const totalRadiation = data.reduce((acc, item) => acc + item.radiation, 0);
    const avgRadiation = totalRadiation / data.length;
    
    // Average temperature in °C
    const totalTemp = data.reduce((acc, item) => acc + item.temperature, 0);
    const avgTemp = totalTemp / data.length;
    
    return {
      maxYield: maxYield.toFixed(2),
      avgRadiation: Math.round(avgRadiation),
      avgTemp: avgTemp.toFixed(1)
    };
  }, [data]);

  // Filter the selected day's 24 hours to active daylight hours (06:00 to 19:00)
  // This helps visualize the solar output vs cloud cover correlation where it matters most.
  const daylightSlice = useMemo(() => {
    if (groupedDays.length === 0 || !groupedDays[selectedDayIndex]) return [];
    
    return groupedDays[selectedDayIndex].data.filter(item => {
      const date = new Date(item.time);
      const hour = date.getHours();
      return hour >= 6 && hour <= 19; // Filter to sunlight window
    }).map(item => {
      const date = new Date(item.time);
      const formattedTime = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      return {
        ...item,
        timeLabel: formattedTime,
        // Invert cloud cover representation to visually align power dips with heavy clouds
        cloudCoverInverted: 100 - item.cloudCover 
      };
    });
  }, [groupedDays, selectedDayIndex]);

  // X-Axis tick formatter for the 7-day AreaChart (shows weekday ticks)
  const formatXAxisTick = (tickVal) => {
    if (!tickVal) return '';
    try {
      const date = new Date(tickVal);
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } catch {
      return tickVal;
    }
  };

  // Tooltip formatter for the 7-day AreaChart (shows readable dates & yields)
  const CustomTooltipArea = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      const date = new Date(item.time);
      const formattedDate = date.toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      }) + ' ' + date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: true 
      });

      return (
        <div className="bg-white/95 border border-amber-100 p-4 shadow-xl rounded-xl backdrop-blur-md">
          <p className="text-xs font-semibold text-gray-500 mb-2">{formattedDate}</p>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-sm text-gray-700">
                <Zap className="w-4 h-4 text-amber-500 fill-amber-100" />
                Predicted Yield:
              </span>
              <span className="text-sm font-bold text-amber-600">{item.predictedYieldKw} kW</span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-sm text-gray-700">
                <Sun className="w-4 h-4 text-orange-500" />
                Solar Radiation:
              </span>
              <span className="text-sm font-medium text-gray-900">{item.radiation} W/m²</span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-sm text-gray-700">
                <Cloud className="w-4 h-4 text-blue-500" />
                Cloud Cover:
              </span>
              <span className="text-sm font-medium text-gray-900">{item.cloudCover}%</span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-sm text-gray-700">
                <Thermometer className="w-4 h-4 text-red-500" />
                Temperature:
              </span>
              <span className="text-sm font-medium text-gray-900">{item.temperature} °C</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col antialiased">
      
      {/* 1. TOP HEADER & NAVIGATION BAR */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          {/* App Title */}
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-amber-500 to-orange-400 rounded-xl text-white shadow-md shadow-amber-500/20">
              <Sun className="w-6 h-6 animate-spin-slow" style={{ animationDuration: '20s' }} />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight flex items-center gap-1.5">
                Helios<span className="text-amber-500">Forecast</span>
              </h1>
              <p className="text-xs font-medium text-gray-500 tracking-wider uppercase">Solar Generation AI Predictor</p>
            </div>
          </div>

          {/* Quick Preset Badges */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-gray-400 mr-1 flex items-center gap-1">
              <Compass className="w-3.5 h-3.5" /> Presets:
            </span>
            {LOCATION_PRESETS.map((preset, idx) => (
              <button
                key={idx}
                onClick={() => handlePresetSelect(preset)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-amber-500 hover:text-white rounded-lg transition-all duration-200 border border-transparent shadow-sm hover:shadow-amber-500/20"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8">
        
        {/* 2. CONTROL PANEL CARD */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 glow-amber">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Gauge className="w-5 h-5 text-amber-500" />
            Solar Array Parameters & Coordinates
          </h2>
          
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              fetchForecast();
            }}
            className="grid grid-cols-1 md:grid-cols-4 gap-5 items-end"
          >
            {/* Latitude Input */}
            <div className="space-y-2">
              <label htmlFor="latitude" className="block text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-gray-400" />
                Latitude
              </label>
              <input
                id="latitude"
                type="number"
                step="any"
                min="-90"
                max="90"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="e.g. 33.4484"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all"
                required
              />
            </div>

            {/* Longitude Input */}
            <div className="space-y-2">
              <label htmlFor="longitude" className="block text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-gray-400" />
                Longitude
              </label>
              <input
                id="longitude"
                type="number"
                step="any"
                min="-180"
                max="180"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                placeholder="e.g. -112.0740"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all"
                required
              />
            </div>

            {/* Capacity Input */}
            <div className="space-y-2">
              <label htmlFor="capacity" className="block text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-gray-400" />
                System Capacity (kW)
              </label>
              <input
                id="capacity"
                type="number"
                step="0.1"
                min="0.1"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="e.g. 5.0"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all"
                required
              />
            </div>

            {/* Action Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold py-2.5 px-5 rounded-xl text-sm shadow-md shadow-amber-500/10 hover:shadow-lg hover:shadow-amber-500/20 transition-all flex items-center justify-center gap-2 group disabled:opacity-75 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <RotateCw className="w-4 h-4 animate-spin" />
                  Updating Forecast...
                </>
              ) : (
                <>
                  <RotateCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                  Update Forecast
                </>
              )}
            </button>
          </form>
        </section>

        {/* ERROR MESSAGE DISPLAY */}
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-5 flex items-start gap-3.5 text-red-800 animate-pulse-slow">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-red-900">Forecast Fetch Failed</h3>
              <p className="text-sm mt-1">{error}</p>
              <button 
                onClick={() => fetchForecast()} 
                className="mt-3 text-xs font-bold bg-white text-red-800 px-3.5 py-1.5 rounded-lg border border-red-200 hover:bg-red-100 transition"
              >
                Retry Request
              </button>
            </div>
          </div>
        )}

        {/* 3. KPI SUMMARY CARDS */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Max Output */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="space-y-1">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Max Predicted Output</span>
              <span className="text-3xl font-extrabold text-gray-900 block">{isLoading ? '—' : `${kpis.maxYield} kW`}</span>
              <span className="text-xs font-medium text-amber-500 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" /> Peak efficiency point
              </span>
            </div>
            <div className="p-4 bg-amber-50 rounded-2xl text-amber-500 group-hover:bg-amber-500 group-hover:text-white transition-all duration-300">
              <Zap className="w-7 h-7 fill-current" />
            </div>
            <div className="absolute top-0 left-0 w-1.5 h-full bg-amber-500"></div>
          </div>

          {/* Card 2: Average Solar Radiation */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="space-y-1">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Avg Solar Radiation</span>
              <span className="text-3xl font-extrabold text-gray-900 block">{isLoading ? '—' : `${kpis.avgRadiation} W/m²`}</span>
              <span className="text-xs font-medium text-orange-500 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" /> 7-day atmospheric avg
              </span>
            </div>
            <div className="p-4 bg-orange-50 rounded-2xl text-orange-500 group-hover:bg-orange-500 group-hover:text-white transition-all duration-300">
              <Sun className="w-7 h-7" />
            </div>
            <div className="absolute top-0 left-0 w-1.5 h-full bg-orange-500"></div>
          </div>

          {/* Card 3: Average Atmospheric Temp */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group">
            <div className="space-y-1">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Avg Temperature</span>
              <span className="text-3xl font-extrabold text-gray-900 block">{isLoading ? '—' : `${kpis.avgTemp} °C`}</span>
              <span className="text-xs font-medium text-red-500 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" /> Thermal derating factor
              </span>
            </div>
            <div className="p-4 bg-red-50 rounded-2xl text-red-500 group-hover:bg-red-500 group-hover:text-white transition-all duration-300">
              <Thermometer className="w-7 h-7" />
            </div>
            <div className="absolute top-0 left-0 w-1.5 h-full bg-red-500"></div>
          </div>
        </section>

        {/* 4. CHARTS VISUALIZATION GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* CHART 1: MAIN 7-DAY AREA CHART (Takes 2 Columns) */}
          <section className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-all">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-amber-500" />
                    7-Day Power Generation Forecast
                  </h2>
                  <p className="text-xs font-medium text-gray-400">Hourly predicted energy production in kW</p>
                </div>
                {data.length > 0 && (
                  <div className="text-xs font-bold text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-100 flex items-center gap-1">
                    <Info className="w-3.5 h-3.5" />
                    ML Model + Fallback simulation
                  </div>
                )}
              </div>

              {/* Chart Container */}
              <div className="h-80 w-full">
                {isLoading ? (
                  <div className="h-full w-full flex flex-col items-center justify-center text-gray-400 gap-3">
                    <RotateCw className="w-8 h-8 animate-spin text-amber-500" />
                    <span className="text-sm font-semibold">Loading charts...</span>
                  </div>
                ) : data.length === 0 ? (
                  <div className="h-full w-full flex flex-col items-center justify-center text-gray-400">
                    <AlertCircle className="w-8 h-8 text-gray-300 mb-2" />
                    <span className="text-sm">No forecast data available. Click "Update Forecast".</span>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={data}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="yieldGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.45}/>
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.01}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis 
                        dataKey="time" 
                        tickFormatter={formatXAxisTick} 
                        stroke="#9ca3af"
                        tickLine={false}
                        axisLine={false}
                        style={{ fontSize: '11px', fontWeight: 500 }}
                        interval={23} // Show one label per day roughly
                      />
                      <YAxis 
                        stroke="#9ca3af"
                        tickLine={false}
                        axisLine={false}
                        style={{ fontSize: '11px', fontWeight: 500 }}
                      />
                      <Tooltip content={<CustomTooltipArea />} />
                      <Area 
                        type="monotone" 
                        dataKey="predictedYieldKw" 
                        stroke="#f59e0b" 
                        strokeWidth={2.5}
                        fillOpacity={1} 
                        fill="url(#yieldGradient)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            
            <div className="border-t border-gray-100 pt-4 mt-4 text-xs font-medium text-gray-400 flex items-center justify-between">
              <span>X-axis shows weekdays</span>
              <span>Y-axis shows power yield (kW)</span>
            </div>
          </section>

          {/* CHART 2: SECONDARY DAYLIGHT CORRELATION CHART (Takes 1 Column) */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-all">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-blue-500" />
                  Daylight Correlation
                </h2>
                <p className="text-xs font-medium text-gray-400">Power drop correlation to cloud levels</p>
              </div>

              {/* Dropdown Selector for Day */}
              {groupedDays.length > 0 && (
                <div>
                  <label htmlFor="day-selector" className="sr-only">Select Forecast Day</label>
                  <select
                    id="day-selector"
                    value={selectedDayIndex}
                    onChange={(e) => setSelectedDayIndex(parseInt(e.target.value))}
                    className="w-full bg-gray-50 border border-gray-200 px-3.5 py-2 rounded-xl text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                  >
                    {groupedDays.map((day) => (
                      <option key={day.index} value={day.index}>
                        {day.longLabel}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Chart Container */}
              <div className="h-64 w-full">
                {isLoading ? (
                  <div className="h-full w-full flex flex-col items-center justify-center text-gray-400 gap-3">
                    <RotateCw className="w-8 h-8 animate-spin text-blue-500" />
                    <span className="text-sm font-semibold">Updating chart...</span>
                  </div>
                ) : daylightSlice.length === 0 ? (
                  <div className="h-full w-full flex flex-col items-center justify-center text-gray-400 text-center px-4">
                    <AlertCircle className="w-8 h-8 text-gray-300 mb-2" />
                    <span className="text-xs">No daylight hours found for selected day. Solar radiation must be active.</span>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={daylightSlice}
                      margin={{ top: 10, right: -5, left: -25, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis 
                        dataKey="timeLabel" 
                        stroke="#9ca3af"
                        tickLine={false}
                        axisLine={false}
                        style={{ fontSize: '10px', fontWeight: 500 }}
                      />
                      {/* Left Y-axis (Yield in kW) */}
                      <YAxis 
                        yAxisId="left"
                        stroke="#10b981"
                        tickLine={false}
                        axisLine={false}
                        style={{ fontSize: '10px', fontWeight: 500 }}
                      />
                      {/* Right Y-axis (Cloud Cover in %) */}
                      <YAxis 
                        yAxisId="right"
                        orientation="right"
                        stroke="#3b82f6"
                        tickLine={false}
                        axisLine={false}
                        style={{ fontSize: '10px', fontWeight: 500 }}
                        domain={[0, 100]}
                      />
                      <Tooltip 
                        content={({ active, payload }) => {
                          if (active && payload && payload.length >= 2) {
                            const y = payload.find(p => p.dataKey === 'predictedYieldKw');
                            const c = payload.find(p => p.dataKey === 'cloudCover');
                            return (
                              <div className="bg-white/95 border border-gray-100 p-3 shadow-lg rounded-xl text-xs space-y-1">
                                <p className="font-bold text-gray-700">{payload[0].payload.timeLabel}</p>
                                <p className="text-emerald-600 font-semibold">Yield: {y?.value} kW</p>
                                <p className="text-blue-600 font-semibold">Cloud Cover: {c?.value}%</p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      {/* Green solid line for yield */}
                      <Line 
                        yAxisId="left"
                        type="monotone" 
                        dataKey="predictedYieldKw" 
                        stroke="#10b981" 
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        name="Yield (kW)"
                      />
                      {/* Blue dashed line for cloud cover */}
                      <Line 
                        yAxisId="right"
                        type="monotone" 
                        dataKey="cloudCover" 
                        stroke="#3b82f6" 
                        strokeDasharray="5 5"
                        strokeWidth={2}
                        dot={false}
                        name="Cloud Cover (%)"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-3 text-[10px] font-medium text-gray-400 flex justify-between">
              <span className="text-emerald-500 font-semibold">● Yield (kW)</span>
              <span className="text-blue-500 font-semibold">-- Cloud Cover (%)</span>
            </div>
          </section>

        </div>
        
        {/* 5. METEO DETAILS & PHYSICS BLOCK */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="text-md font-bold text-gray-900 flex items-center gap-2">
              <Info className="w-5 h-5 text-amber-500" />
              How predictedYieldKw is calculated
            </h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              HeliosForecast integrates live forecasts from the <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline font-semibold">Open-Meteo API</a>. By default, it queries a machine learning classifier model (<code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono text-amber-700">solar_model.pkl</code>) constructed with <strong>scikit-learn</strong>.
            </p>
            <p className="text-sm text-gray-500 leading-relaxed">
              If the model file is not present on the server, the system automatically falls back to an advanced environmental formula modeling standard thermal panel degradation and cloud shading.
            </p>
          </div>
          <div className="bg-amber-50/50 rounded-xl p-5 border border-amber-50 text-xs text-gray-600 space-y-2 flex flex-col justify-center">
            <span className="font-bold text-amber-800 uppercase tracking-wider block">Fallback Math Formulation:</span>
            <pre className="p-3 bg-white rounded-lg border border-amber-100 overflow-x-auto text-[10px] font-mono text-gray-700 leading-normal">
{`predicted_kw = capacity * (radiation / 1000)
             * (0.20 * (1 - max(0, (temp - 25) * 0.004)))
             * (1 - (cloudcover / 100 * 0.75))`}
            </pre>
            <span className="text-[10px] text-gray-400 leading-relaxed">
              * The formula derates efficiency by 0.4% per degree above 25°C and scales down performance by up to 75% under 100% cloud cover.
            </span>
          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t border-gray-100 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs font-semibold text-gray-400 space-y-1">
          <p>© 2026 HeliosForecast. Built as a Senior Full-Stack ML Dashboard.</p>
          <p>Weather data fetched in real-time from open-meteo.com.</p>
        </div>
      </footer>

    </div>
  );
}
