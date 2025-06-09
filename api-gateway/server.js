const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const services = {
    usuarios: 'http://localhost:3001',
    alarmes: 'http://localhost:3002',
    acionamento: 'http://localhost:3003',
    disparo: 'http://localhost:3004',
    notificacao: 'http://localhost:3005',
    logs: 'http://localhost:3006'
};

Object.keys(services).forEach(service => {
    app.use(`/api/${service}`, createProxyMiddleware({
        target: services[service],
        changeOrigin: true,
        pathRewrite: {
            [`^/api/${service}`]: ''
        },
        onError: (err, req, res) => {
            console.error(`Proxy error for ${service}:`, err.message);
            res.status(503).json({ 
                error: 'Service Unavailable', 
                message: `${service} service is not available` 
            });
        }
    }));
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        services: Object.keys(services)
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'Sistema de Controle de Alarmes - API Gateway',
        version: '1.0.0',
        endpoints: {
            usuarios: '/api/usuarios',
            alarmes: '/api/alarmes',
            acionamento: '/api/acionamento',
            disparo: '/api/disparo',
            notificacao: '/api/notificacao',
            logs: '/api/logs'
        }
    });
});

app.use((err, req, res, next) => {
    console.error('Gateway error:', err);
    res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'Gateway error occurred'
    });
});

app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);
    console.log('Available routes:');
    Object.keys(services).forEach(service => {
        console.log(`  /api/${service} -> ${services[service]}`);
    });
});
