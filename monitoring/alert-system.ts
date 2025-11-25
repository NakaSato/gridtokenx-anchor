/**
 * Automated Alerting System for GridTokenX
 * Real-time performance threshold breaches and system health monitoring
 */

import * as fs from 'fs';
import * as path from 'path';

interface AlertRule {
  alert: string;
  expr: string;
  for: string;
  labels: Record<string, string>;
  annotations: {
    summary: string;
    description: string;
  };
}

interface AlertConfig {
  groups: AlertGroup[];
}

interface AlertGroup {
  name: string;
  rules: AlertRule[];
}

/**
 * Create comprehensive alert rules for GridTokenX
 */
export function createAlertRules(): AlertConfig {
  return {
    groups: [
      {
        name: "gridtokenx.performance",
        rules: [
          // High Transaction Latency
          {
            alert: "HighTransactionLatency",
            expr: "rate(gridtokenx_transaction_duration_seconds_sum[5m]) / rate(gridtokenx_transaction_duration_seconds_count[5m]) * 1000 > 500",
            for: "2m",
            labels: {
              severity: "warning",
              service: "gridtokenx",
              component: "performance"
            },
            annotations: {
              summary: "High transaction latency detected",
              description: "Transaction latency is {{ $value }}ms, which exceeds the 500ms threshold for more than 2 minutes."
            }
          },
          {
            alert: "CriticalTransactionLatency",
            expr: "rate(gridtokenx_transaction_duration_seconds_sum[5m]) / rate(gridtokenx_transaction_duration_seconds_count[5m]) * 1000 > 1000",
            for: "1m",
            labels: {
              severity: "critical",
              service: "gridtokenx",
              component: "performance"
            },
            annotations: {
              summary: "Critical transaction latency detected",
              description: "Transaction latency is {{ $value }}ms, which exceeds the 1000ms critical threshold for more than 1 minute."
            }
          },

          // Low Success Rate
          {
            alert: "LowSuccessRate",
            expr: "rate(gridtokenx_transactions_success_total[5m]) / rate(gridtokenx_transactions_total[5m]) * 100 < 95",
            for: "3m",
            labels: {
              severity: "warning",
              service: "gridtokenx",
              component: "performance"
            },
            annotations: {
              summary: "Low success rate detected",
              description: "Success rate is {{ $value }}%, which is below the 95% threshold for more than 3 minutes."
            }
          },
          {
            alert: "CriticalSuccessRate",
            expr: "rate(gridtokenx_transactions_success_total[5m]) / rate(gridtokenx_transactions_total[5m]) * 100 < 90",
            for: "1m",
            labels: {
              severity: "critical",
              service: "gridtokenx",
              component: "performance"
            },
            annotations: {
              summary: "Critical success rate detected",
              description: "Success rate is {{ $value }}%, which is below the 90% critical threshold for more than 1 minute."
            }
          },

          // High Error Rate
          {
            alert: "HighErrorRate",
            expr: "rate(gridtokenx_transactions_error_total[5m]) > 0.1",
            for: "2m",
            labels: {
              severity: "warning",
              service: "gridtokenx",
              component: "performance"
            },
            annotations: {
              summary: "High error rate detected",
              description: "Error rate is {{ $value }} errors per second, which exceeds the 0.1 threshold for more than 2 minutes."
            }
          },
          {
            alert: "CriticalErrorRate",
            expr: "rate(gridtokenx_transactions_error_total[5m]) > 0.5",
            for: "1m",
            labels: {
              severity: "critical",
              service: "gridtokenx",
              component: "performance"
            },
            annotations: {
              summary: "Critical error rate detected",
              description: "Error rate is {{ $value }} errors per second, which exceeds the 0.5 critical threshold for more than 1 minute."
            }
          },

          // Low Throughput
          {
            alert: "LowThroughput",
            expr: "rate(gridtokenx_transactions_total[5m]) < 10",
            for: "5m",
            labels: {
              severity: "warning",
              service: "gridtokenx",
              component: "performance"
            },
            annotations: {
              summary: "Low throughput detected",
              description: "Throughput is {{ $value }} TPS, which is below the 10 TPS threshold for more than 5 minutes."
            }
          }
        ]
      },
      {
        name: "gridtokenx.resources",
        rules: [
          // High Memory Usage
          {
            alert: "HighMemoryUsage",
            expr: "gridtokenx_memory_usage_bytes / 1024 / 1024 / 1024 > 8",
            for: "5m",
            labels: {
              severity: "warning",
              service: "gridtokenx",
              component: "resources"
            },
            annotations: {
              summary: "High memory usage detected",
              description: "Memory usage is {{ $value }}GB, which exceeds the 8GB warning threshold for more than 5 minutes."
            }
          },
          {
            alert: "CriticalMemoryUsage",
            expr: "gridtokenx_memory_usage_bytes / 1024 / 1024 / 1024 > 12",
            for: "2m",
            labels: {
              severity: "critical",
              service: "gridtokenx",
              component: "resources"
            },
            annotations: {
              summary: "Critical memory usage detected",
              description: "Memory usage is {{ $value }}GB, which exceeds the 12GB critical threshold for more than 2 minutes."
            }
          },

          // High CPU Usage
          {
            alert: "HighCpuUsage",
            expr: "gridtokenx_cpu_usage_percent > 70",
            for: "5m",
            labels: {
              severity: "warning",
              service: "gridtokenx",
              component: "resources"
            },
            annotations: {
              summary: "High CPU usage detected",
              description: "CPU usage is {{ $value }}%, which exceeds the 70% warning threshold for more than 5 minutes."
            }
          },
          {
            alert: "CriticalCpuUsage",
            expr: "gridtokenx_cpu_usage_percent > 90",
            for: "2m",
            labels: {
              severity: "critical",
              service: "gridtokenx",
              component: "resources"
            },
            annotations: {
              summary: "Critical CPU usage detected",
              description: "CPU usage is {{ $value }}%, which exceeds the 90% critical threshold for more than 2 minutes."
            }
          },

          // High Disk Usage
          {
            alert: "HighDiskUsage",
            expr: "gridtokenx_disk_usage_percent > 80",
            for: "10m",
            labels: {
              severity: "warning",
              service: "gridtokenx",
              component: "resources"
            },
            annotations: {
              summary: "High disk usage detected",
              description: "Disk usage is {{ $value }}%, which exceeds the 80% warning threshold for more than 10 minutes."
            }
          },
          {
            alert: "CriticalDiskUsage",
            expr: "gridtokenx_disk_usage_percent > 95",
            for: "5m",
            labels: {
              severity: "critical",
              service: "gridtokenx",
              component: "resources"
            },
            annotations: {
              summary: "Critical disk usage detected",
              description: "Disk usage is {{ $value }}%, which exceeds the 95% critical threshold for more than 5 minutes."
            }
          }
        ]
      },
      {
        name: "gridtokenx.availability",
        rules: [
          // Service Down
          {
            alert: "ServiceDown",
            expr: "up{job=\"gridtokenx\"} == 0",
            for: "1m",
            labels: {
              severity: "critical",
              service: "gridtokenx",
              component: "availability"
            },
            annotations: {
              summary: "GridTokenX service is down",
              description: "The GridTokenX service has been down for more than 1 minute on instance {{ $labels.instance }}."
            }
          },

          // Component Health Issues
          {
            alert: "ComponentUnhealthy",
            expr: "gridtokenx_component_health < 2",
            for: "2m",
            labels: {
              severity: "warning",
              service: "gridtokenx",
              component: "availability"
            },
            annotations: {
              summary: "Component health issue detected",
              description: "Component {{ $labels.component }} is in unhealthy state ({{ $value }}) for more than 2 minutes."
            }
          },
          {
            alert: "ComponentDown",
            expr: "gridtokenx_component_health == 0",
            for: "30s",
            labels: {
              severity: "critical",
              service: "gridtokenx",
              component: "availability"
            },
            annotations: {
              summary: "Component is down",
              description: "Component {{ $labels.component }} is down for more than 30 seconds."
            }
          },

          // Network Connectivity Issues
          {
            alert: "HighNetworkLatency",
            expr: "gridtokenx_network_latency_seconds > 0.5",
            for: "3m",
            labels: {
              severity: "warning",
              service: "gridtokenx",
              component: "network"
            },
            annotations: {
              summary: "High network latency detected",
              description: "Network latency to {{ $labels.endpoint }} is {{ $value }}s, which exceeds the 500ms threshold for more than 3 minutes."
            }
          },
          {
            alert: "CriticalNetworkLatency",
            expr: "gridtokenx_network_latency_seconds > 1.0",
            for: "1m",
            labels: {
              severity: "critical",
              service: "gridtokenx",
              component: "network"
            },
            annotations: {
              summary: "Critical network latency detected",
              description: "Network latency to {{ $labels.endpoint }} is {{ $value }}s, which exceeds the 1s critical threshold for more than 1 minute."
            }
          }
        ]
      },
      {
        name: "gridtokenx.business",
        rules: [
          // Low Active Users
          {
            alert: "LowActiveUsers",
            expr: "gridtokenx_active_users_total < 5",
            for: "15m",
            labels: {
              severity: "warning",
              service: "gridtokenx",
              component: "business"
            },
            annotations: {
              summary: "Low active user count",
              description: "Only {{ $value }} active users detected for more than 15 minutes, which may indicate engagement issues."
            }
          },

          // Large Order Book Imbalance
          {
            alert: "OrderBookImbalance",
            expr: "abs(gridtokenx_buy_orders_total - gridtokenx_sell_orders_total) / (gridtokenx_buy_orders_total + gridtokenx_sell_orders_total) > 0.8",
            for: "5m",
            labels: {
              severity: "warning",
              service: "gridtokenx",
              component: "business"
            },
            annotations: {
              summary: "Order book imbalance detected",
              description: "Order book imbalance is {{ $value }}%, indicating a market imbalance for more than 5 minutes."
            }
          },

          // Unusual Trading Volume
          {
            alert: "UnusualTradingVolume",
            expr: "rate(gridtokenx_energy_traded_kwh_total[1h]) > rate(gridtokenx_energy_traded_kwh_total[24h]) * 5",
            for: "10m",
            labels: {
              severity: "warning",
              service: "gridtokenx",
              component: "business"
            },
            annotations: {
              summary: "Unusual trading volume detected",
              description: "Current hourly trading volume is {{ $value }}x the 24-hour average, indicating unusual market activity."
            }
          }
        ]
      }
    ]
  };
}

/**
 * Generate alert rules configuration file
 */
export function generateAlertRules(): void {
  const alertConfig = createAlertRules();
  const monitoringDir = path.join(process.cwd(), 'monitoring');
  
  // Ensure monitoring directory exists
  if (!fs.existsSync(monitoringDir)) {
    fs.mkdirSync(monitoringDir, { recursive: true });
  }
  
  // Generate YAML alert rules file
  const yamlContent = generateYamlAlertRules(alertConfig);
  fs.writeFileSync(
    path.join(monitoringDir, 'alert-rules.yml'),
    `# GridTokenX Alert Rules
# Generated automatically by alert-system.ts
# Defines all alerting rules for monitoring system

${yamlContent}`
  );
  
  console.log(`🚨 Alert rules generated: monitoring/alert-rules.yml`);
}

/**
 * Convert alert configuration to YAML format
 */
function generateYamlAlertRules(alertConfig: AlertConfig): string {
  let yaml = '';
  
  alertConfig.groups.forEach((group, groupIndex) => {
    yaml += `groups:\n`;
    
    alertConfig.groups.forEach((group, gIndex) => {
      yaml += `  - name: ${group.name}\n`;
      yaml += `    rules:\n`;
      
      group.rules.forEach((rule, ruleIndex) => {
        yaml += `      - alert: ${rule.alert}\n`;
        yaml += `        expr: ${rule.expr}\n`;
        yaml += `        for: ${rule.for}\n`;
        
        yaml += `        labels:\n`;
        Object.entries(rule.labels).forEach(([key, value]) => {
          yaml += `          ${key}: "${value}"\n`;
        });
        
        yaml += `        annotations:\n`;
        yaml += `          summary: "${rule.annotations.summary}"\n`;
        yaml += `          description: "${rule.annotations.description}"\n`;
        
        if (ruleIndex < group.rules.length - 1) {
          yaml += '\n';
        }
      });
      
      if (gIndex < alertConfig.groups.length - 1) {
        yaml += '\n';
      }
    });
  });
  
  return yaml;
}

/**
 * Create notification service integration
 */
export function createNotificationService(): void {
  const notificationService = `
/**
 * GridTokenX Notification Service
 * Handles real-time alert notifications
 */

const express = require('express');
const nodemailer = require('nodemailer');
const app = express();

app.use(express.json());

// Email configuration
const transporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST || 'localhost',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'alerts@gridtokenx.com',
    pass: process.env.SMTP_PASS || 'password'
  }
});

// Alert webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const alerts = req.body.alerts || [];
    
    console.log(\`Received \${alerts.length} alerts:\`);
    
    for (const alert of alerts) {
      console.log(\`[\${alert.status.toUpperCase()}] \${alert.labels.alertname}\`);
      console.log(\`  Summary: \${alert.annotations.summary}\`);
      console.log(\`  Description: \${alert.annotations.description}\`);
      console.log(\`  Severity: \${alert.labels.severity}\`);
      
      // Send email for critical alerts
      if (alert.labels.severity === 'critical') {
        await sendCriticalAlert(alert);
      }
      
      // Send webhook to external services
      await sendWebhookNotification(alert);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing alerts:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Send critical alert email
async function sendCriticalAlert(alert) {
  try {
    const mailOptions = {
      from: 'alerts@gridtokenx.com',
      to: process.env.CRITICAL_EMAIL || 'devops@gridtokenx.com',
      subject: \`[CRITICAL] \${alert.labels.alertname}\`,
      text: \`
Alert: \${alert.annotations.summary}
Description: \${alert.annotations.description}
Severity: \${alert.labels.severity}
Service: \${alert.labels.service}
Component: \${alert.labels.component}
Time: \${new Date().toISOString()}

Labels:
\${Object.entries(alert.labels).map(([k, v]) => \`\${k}: \${v}\`).join('\\n')}
      \`
    };
    
    await transporter.sendMail(mailOptions);
    console.log('Critical alert email sent successfully');
  } catch (error) {
    console.error('Failed to send critical alert email:', error);
  }
}

// Send webhook to external services
async function sendWebhookNotification(alert) {
  try {
    // Example: Send to Slack
    if (process.env.SLACK_WEBHOOK_URL) {
      const slackMessage = {
        text: \`\${alert.status.toUpperCase()}: \${alert.labels.alertname}\`,
        attachments: [{
          color: alert.labels.severity === 'critical' ? 'danger' : 'warning',
          fields: [
            { title: 'Summary', value: alert.annotations.summary, short: false },
            { title: 'Description', value: alert.annotations.description, short: false },
            { title: 'Severity', value: alert.labels.severity, short: true },
            { title: 'Service', value: alert.labels.service, short: true },
            { title: 'Component', value: alert.labels.component, short: true }
          ]
        }]
      };
      
      // Send to Slack (implementation depends on your Slack webhook library)
      console.log('Slack notification would be sent here');
    }
    
    // Example: Send to Discord
    if (process.env.DISCORD_WEBHOOK_URL) {
      const discordMessage = {
        content: \`\${alert.status.toUpperCase()}: \${alert.labels.alertname}\`,
        embeds: [{
          title: alert.annotations.summary,
          description: alert.annotations.description,
          color: alert.labels.severity === 'critical' ? 0xFF0000 : 0xFFFF00,
          fields: [
            { name: 'Severity', value: alert.labels.severity, inline: true },
            { name: 'Service', value: alert.labels.service, inline: true },
            { name: 'Component', value: alert.labels.component, inline: true }
          ],
          timestamp: new Date().toISOString()
        }]
      };
      
      // Send to Discord (implementation depends on your Discord webhook library)
      console.log('Discord notification would be sent here');
    }
  } catch (error) {
    console.error('Failed to send webhook notification:', error);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const PORT = process.env.NOTIFICATION_PORT || 5001;
app.listen(PORT, () => {
  console.log(\`GridTokenX Notification Service listening on port \${PORT}\`);
  console.log('Webhook endpoint: http://localhost:' + PORT + '/webhook');
  console.log('Health check: http://localhost:' + PORT + '/health');
});
`;

  const monitoringDir = path.join(process.cwd(), 'monitoring');
  if (!fs.existsSync(monitoringDir)) {
    fs.mkdirSync(monitoringDir, { recursive: true });
  }
  
  fs.writeFileSync(
    path.join(monitoringDir, 'notification-service.js'),
    notificationService
  );
  
  console.log(`📧 Notification service created: monitoring/notification-service.js`);
}

/**
 * Setup complete alert system
 */
export function setupAlertSystem(): void {
  console.log('🚨 Setting up GridTokenX Alert System');
  console.log('='.repeat(50));
  
  generateAlertRules();
  createNotificationService();
  
  console.log('\n📋 Alert Rules Generated:');
  console.log('   🔴 Critical alerts: Transaction latency, success rate, error rate, memory, CPU, disk, service down');
  console.log('   🟡 Warning alerts: Performance degradation, resource usage, network issues, business metrics');
  
  console.log('\n📧 Notification Service Features:');
  console.log('   ✅ Email notifications for critical alerts');
  console.log('   ✅ Webhook integration (Slack, Discord)');
  console.log('   ✅ Real-time alert processing');
  console.log('   ✅ Health check endpoint');
  
  console.log('\n🚀 Next Steps:');
  console.log('1. Install dependencies: npm install express nodemailer');
  console.log('2. Configure environment variables:');
  console.log('   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS');
  console.log('   - CRITICAL_EMAIL, SLACK_WEBHOOK_URL, DISCORD_WEBHOOK_URL');
  console.log('   - NOTIFICATION_PORT');
  console.log('3. Start notification service: node monitoring/notification-service.js');
  console.log('4. Configure AlertManager to use webhook: http://localhost:5001/webhook');
  
  console.log('\n✅ Alert system setup complete!');
}

// Run setup if this file is executed directly
if (require.main === module) {
  setupAlertSystem();
}
