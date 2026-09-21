const axios = require("axios");
const config = require("../config");

const geocodingClient = axios.create({
  baseURL: "https://geocoding-api.open-meteo.com/v1",
  timeout: config.requestTimeoutMs,
});
const forecastClient = axios.create({
  baseURL: "https://api.open-meteo.com/v1",
  timeout: config.requestTimeoutMs,
});

const WEATHER_CODES = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with hail",
};

module.exports = {
  name: "weather",
  category: "Utility",
  usage: "!weather <city>",
  description: "Show the current weather for a city.",
  cooldownSeconds: 10,
  handler: async (_user, args) => {
    const city = args.join(" ").trim();
    if (!city) return "Usage: !weather <city>\nExample: !weather Manila";
    if (city.length > 100) return "Please provide a shorter city name.";

    try {
      const locationResponse = await geocodingClient.get("/search", {
        params: { name: city, count: 1, language: "en", format: "json" },
      });
      const location = locationResponse.data?.results?.[0];
      if (!location) return `I couldn't find a location named "${city}".`;

      const weatherResponse = await forecastClient.get("/forecast", {
        params: {
          latitude: location.latitude,
          longitude: location.longitude,
          current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
          timezone: "auto",
        },
      });
      const current = weatherResponse.data?.current;
      if (!current) throw new Error("Weather response did not contain current conditions.");

      const unit = weatherResponse.data.current_units || {};
      const description = WEATHER_CODES[current.weather_code] || "Unknown conditions";
      return [
        `╭── WEATHER · ${location.name} ──⭓`,
        `│ 🌡️ Temperature: ${current.temperature_2m}${unit.temperature_2m || "°C"}`,
        `│ 🤔 Feels like: ${current.apparent_temperature}${unit.apparent_temperature || "°C"}`,
        `│ ☁️ Conditions: ${description}`,
        `│ 💧 Humidity: ${current.relative_humidity_2m}${unit.relative_humidity_2m || "%"}`,
        `│ 💨 Wind: ${current.wind_speed_10m}${unit.wind_speed_10m || " km/h"}`,
        `│ 🕒 Local time: ${current.time}`,
        "╰────────⭓",
      ].join("\n");
    } catch (error) {
      throw new Error(`Weather provider request failed: ${error.message}`);
    }
  },
};
