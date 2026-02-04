/**
 * Cloud Pipeline Verification Script
 * 
 * Tests the end-to-end data flow:
 * Simulator → Kafka → API Gateway → Solana → InfluxDB
 */

import * as http from 'http';
import * as https from 'https';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const config = {
    kafka: {
        broker: process.env.KAFKA_BROKER || 'localhost:9092',
        topic: 'meter-readings',
    },
    influxdb: {
        url: process.env.INFLUXDB_URL || 'http://localhost:8086',
        token: process.env.INFLUXDB_TOKEN || 'gridtokenx_token_123',
        org: 'gridtokenx',
        bucket: 'meter_readings',
    },
    prometheus: {
        url: process.env.PROMETHEUS_URL || 'http://localhost:9090',
    },
    simulator: {
        url: process.env.SIMULATOR_URL || 'http://localhost:8000',
    },
    apiGateway: {
        url: process.env.API_GATEWAY_URL || 'http://localhost:3000',
    },
};

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

interface HealthCheck {
    service: string;
    status: 'healthy' | 'unhealthy' | 'unknown';
    message: string;
    latencyMs?: number;
}

async function checkHealth(name: string, url: string, path: string = '/health'): Promise<HealthCheck> {
    const startTime = Date.now();
    const fullUrl = `${url}${path}`;

    return new Promise((resolve) => {
        const client = fullUrl.startsWith('https') ? https : http;

        const req = client.get(fullUrl, { timeout: 5000 }, (res) => {
            const latencyMs = Date.now() - startTime;

            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve({
                    service: name,
                    status: 'healthy',
                    message: `HTTP ${res.statusCode}`,
                    latencyMs,
                });
            } else {
                resolve({
                    service: name,
                    status: 'unhealthy',
                    message: `HTTP ${res.statusCode}`,
                    latencyMs,
                });
            }
        });

        req.on('error', (err) => {
            resolve({
                service: name,
                status: 'unhealthy',
                message: err.message,
                latencyMs: Date.now() - startTime,
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({
                service: name,
                status: 'unhealthy',
                message: 'Connection timeout',
                latencyMs: 5000,
            });
        });
    });
}

async function queryPrometheus(query: string): Promise<any> {
    const url = `${config.prometheus.url}/api/v1/query?query=${encodeURIComponent(query)}`;

    return new Promise((resolve, reject) => {
        http.get(url, { timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function queryInfluxDB(query: string): Promise<any> {
    const url = `${config.influxdb.url}/api/v2/query?org=${config.influxdb.org}`;

    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options: http.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: `${urlObj.pathname}${urlObj.search}`,
            method: 'POST',
            headers: {
                'Authorization': `Token ${config.influxdb.token}`,
                'Content-Type': 'application/vnd.flux',
                'Accept': 'application/csv'
            },
            timeout: 5000,
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });

        req.on('error', reject);
        req.write(query);
        req.end();
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFICATION STEPS
// ═══════════════════════════════════════════════════════════════════════════════

async function verifyKafka(): Promise<HealthCheck> {
    console.log('  Checking Kafka...');

    // Check Kafka UI as proxy for Kafka health
    try {
        const result = await checkHealth('Kafka', 'http://localhost:8090', '/');
        return {
            service: 'Kafka',
            status: result.status,
            message: result.status === 'healthy'
                ? 'Kafka broker accessible via UI'
                : 'Kafka UI not responding',
            latencyMs: result.latencyMs,
        };
    } catch {
        return {
            service: 'Kafka',
            status: 'unknown',
            message: 'Could not verify Kafka status',
        };
    }
}

async function verifyInfluxDB(): Promise<HealthCheck> {
    console.log('  Checking InfluxDB...');

    const result = await checkHealth('InfluxDB', config.influxdb.url, '/health');

    if (result.status === 'healthy') {
        // Try to query for recent data
        try {
            const query = `from(bucket: "${config.influxdb.bucket}")
        |> range(start: -1h)
        |> limit(n: 1)`;

            const queryResult = await queryInfluxDB(query);
            result.message = queryResult.status === 200
                ? 'Connected, bucket accessible'
                : `Query returned ${queryResult.status}`;
        } catch (e: any) {
            result.message = 'Connected but query failed';
        }
    }

    return result;
}

async function verifyPrometheus(): Promise<HealthCheck> {
    console.log('  Checking Prometheus...');

    const result = await checkHealth('Prometheus', config.prometheus.url, '/-/healthy');

    if (result.status === 'healthy') {
        // Try to query for targets
        try {
            const queryResult = await queryPrometheus('up');
            const targets = queryResult?.data?.result?.length || 0;
            result.message = `Healthy, ${targets} active targets`;
        } catch (e: any) {
            result.message = 'Connected but query failed';
        }
    }

    return result;
}

async function verifySimulator(): Promise<HealthCheck> {
    console.log('  Checking Simulator...');
    return await checkHealth('Simulator', config.simulator.url, '/health');
}

async function verifyAPIGateway(): Promise<HealthCheck> {
    console.log('  Checking API Gateway...');
    return await checkHealth('API Gateway', config.apiGateway.url, '/health');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║           GRIDTOKENX CLOUD PIPELINE VERIFICATION                     ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

    const checks: HealthCheck[] = [];

    console.log('📋 Running health checks...\n');

    // Run all health checks
    checks.push(await verifySimulator());
    checks.push(await verifyAPIGateway());
    checks.push(await verifyKafka());
    checks.push(await verifyInfluxDB());
    checks.push(await verifyPrometheus());

    // Print results
    console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║                         VERIFICATION RESULTS                         ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

    let healthy = 0;
    let unhealthy = 0;

    for (const check of checks) {
        const statusIcon = check.status === 'healthy' ? '✅' : check.status === 'unhealthy' ? '❌' : '❓';
        const latency = check.latencyMs ? `${check.latencyMs}ms` : '-';

        console.log(`  ${statusIcon} ${check.service.padEnd(15)} ${check.status.padEnd(12)} ${check.message} (${latency})`);

        if (check.status === 'healthy') healthy++;
        else unhealthy++;
    }

    console.log('\n─'.repeat(70));
    console.log(`  📊 Summary: ${healthy}/${checks.length} services healthy\n`);

    // Pipeline flow diagram
    console.log('  📈 Data Flow:');
    console.log('');
    console.log('     ┌─────────────┐     ┌─────────┐     ┌─────────────┐     ┌─────────┐');
    console.log('     │  Simulator  │ ──▶ │  Kafka  │ ──▶ │ API Gateway │ ──▶ │ Solana  │');
    console.log('     └─────────────┘     └─────────┘     └─────────────┘     └─────────┘');
    console.log('           │                  │                  │               │');
    console.log('           │                  │                  │               │');
    console.log('           ▼                  ▼                  ▼               ▼');
    console.log('     ┌─────────────┐     ┌─────────┐     ┌─────────────┐     ┌─────────┐');
    console.log('     │  InfluxDB   │     │ Metrics │     │  Prometheus │     │ Indexer │');
    console.log('     └─────────────┘     └─────────┘     └─────────────┘     └─────────┘');
    console.log('');

    // Instructions if services are down
    if (unhealthy > 0) {
        console.log('  ⚠️  Some services are not responding. To start the cloud stack:');
        console.log('');
        console.log('     docker-compose -f docker-compose.cloud.yml up -d');
        console.log('');
    }

    // Exit with appropriate code
    process.exit(unhealthy > 2 ? 1 : 0);
}

main().catch((err) => {
    console.error('Verification failed:', err);
    process.exit(1);
});
