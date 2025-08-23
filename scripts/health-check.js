const http = require('http');
const https = require('https');

const healthCheck = async (url, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    const timeoutId = setTimeout(() => {
      reject(new Error(`Health check timeout after ${timeout}ms`));
    }, timeout);

    const req = protocol.get(url, (res) => {
      clearTimeout(timeoutId);
      const isHealthy = res.statusCode >= 200 && res.statusCode < 300;
      resolve({
        url,
        status: res.statusCode,
        healthy: isHealthy,
        message: isHealthy ? 'OK' : `HTTP ${res.statusCode}`
      });
    });

    req.on('error', (error) => {
      clearTimeout(timeoutId);
      reject({
        url,
        status: null,
        healthy: false,
        message: error.message
      });
    });
  });
};

const checkServices = async () => {
  const services = [
    {
      name: 'Backend API',
      url: process.env.BACKEND_URL || 'http://localhost:5000/health'
    },
    {
      name: 'Frontend',
      url: process.env.FRONTEND_URL || 'http://localhost:3000'
    }
  ];

  console.log('🏥 Starting health checks...\n');

  const results = [];
  for (const service of services) {
    try {
      const result = await healthCheck(service.url);
      results.push({ ...service, ...result });
      console.log(`✅ ${service.name}: ${result.message}`);
    } catch (error) {
      results.push({ ...service, ...error });
      console.log(`❌ ${service.name}: ${error.message}`);
    }
  }

  console.log('\n📊 Health Check Summary:');
  console.log('========================');
  
  const healthyServices = results.filter(r => r.healthy);
  const unhealthyServices = results.filter(r => !r.healthy);

  console.log(`Healthy: ${healthyServices.length}/${results.length}`);
  console.log(`Unhealthy: ${unhealthyServices.length}/${results.length}`);

  if (unhealthyServices.length > 0) {
    console.log('\n🚨 Unhealthy Services:');
    unhealthyServices.forEach(service => {
      console.log(`- ${service.name}: ${service.message}`);
    });
    process.exit(1);
  } else {
    console.log('\n🎉 All services are healthy!');
    process.exit(0);
  }
};

// Run health checks
checkServices().catch(error => {
  console.error('Health check failed:', error);
  process.exit(1);
});
