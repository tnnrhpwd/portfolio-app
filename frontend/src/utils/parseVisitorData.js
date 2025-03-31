export default function parseVisitorData(text) {
  if (!text || typeof text !== "string") return null;

  try {
    const ipMatch = text.match(/IP:([^|]+)/);
    const deviceMatch = text.match(/Device:([^|]+)/);
    const osMatch = text.match(/OS:([^|]+)/);
    const browserMatch = text.match(/Browser:([^|]+)/);
    const methodMatch = text.match(/Method:([^|]+)/);
    const urlMatch = text.match(/URL:([^|]+)/);
    const platformMatch = text.match(/Platform:([^|]+)/);
    const cityMatch = text.match(/City:([^|]+)/);
    const regionMatch = text.match(/Region:([^|]+)/);
    const countryMatch = text.match(/Country:([^|]+)/);

    if (!ipMatch) return null;

    // Extract timestamp from data if possible
    const timestamp = new Date().toISOString();

    return {
      ip: ipMatch ? ipMatch[1].trim() : "",
      device: deviceMatch ? deviceMatch[1].trim() : "",
      os: osMatch ? osMatch[1].trim() : "",
      browser: browserMatch ? browserMatch[1].trim() : "",
      method: methodMatch ? methodMatch[1].trim() : "",
      url: urlMatch ? urlMatch[1].trim() : "",
      platform: platformMatch ? platformMatch[1].trim() : "",
      city: cityMatch ? cityMatch[1].trim() : "",
      region: regionMatch ? regionMatch[1].trim() : "",
      country: countryMatch ? countryMatch[1].trim() : "",
      timestamp,
    };
  } catch (error) {
    console.error("Error parsing visitor data:", error);
    return null;
  }
}
