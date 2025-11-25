/**
 * Real-time Performance Dashboard Setup
 * Grafana/Prometheus integration for GridTokenX monitoring
 */

import * as fs from 'fs';
import * as path from 'path';

interface DashboardConfig {
  name: string;
  panels: PanelConfig[];
  variables?: VariableConfig[];
  tags?: string[];
}

interface PanelConfig {
  title: string;
  type: string;
  targets: TargetConfig[];
  gridPos: { x: number; y: number; w: number; h: number };
  options?: any;
  fieldConfig?: any;
}

interface TargetConfig {
  expr: string;
  legendFormat?: string;
  interval?: string;
  refId: string;
  format?: string;
}

interface VariableConfig {
  name: string;
  type: string;
  query: string;
  current?: any;
  options?: any[];
  refresh?: number;
}

/**
 * Create comprehensive performance monitoring dashboard
 */
export function createPerformanceDashboard(): DashboardConfig {
  return {
    name: "GridTokenX Performance Dashboard",
    tags: ["gridtokenx", "performance", "solana"],
    panels: [
      // Transaction Performance Overview
      {
        title: "Transaction Latency (ms)",
        type: "graph",
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
        targets: [
          {
            expr: 'rate(gridtokenx_transaction_duration_seconds_sum[5m]) / rate(gridtokenx_transaction_duration_seconds_count[5m]) * 1000',
            legendFormat: "{{program}} - {{operation}}",
            interval: "5s",
            refId: "A"
          }
        ],
        options: {
          legend: { displayMode: "table", placement: "bottom" },
          tooltip: { mode: "multi", sort: "desc" }
        },
        fieldConfig: {
          defaults: {
            unit: "ms",
            min: 0,
            thresholds: {
              steps: [
                { color: "green", value: null },
                { color: "yellow", value: 200 },
                { color: "red", value: 500 }
              ]
            }
          }
        }
      },

      // Transaction Throughput
      {
        title: "Transactions per Second",
        type: "stat",
        gridPos: { x: 12, y: 0, w: 6, h: 4 },
        targets: [
          {
            expr: 'rate(gridtokenx_transactions_total[5m])',
            legendFormat: "TPS",
            interval: "5s",
            refId: "B"
          }
        ],
        options: {
          reduceOptions: { values: false, calcs: ["lastNotNull"] },
          thresholds: {
            steps: [
              { color: "red", value: null },
              { color: "yellow", value: 10 },
              { color: "green", value: 50 }
            ]
          }
        },
        fieldConfig: {
          defaults: {
            unit: "tps",
            min: 0
          }
        }
      },

      // Success Rate
      {
        title: "Success Rate (%)",
        type: "stat",
        gridPos: { x: 18, y: 0, w: 6, h: 4 },
        targets: [
          {
            expr: 'rate(gridtokenx_transactions_success_total[5m]) / rate(gridtokenx_transactions_total[5m]) * 100',
            legendFormat: "Success Rate",
            interval: "5s",
            refId: "C"
          }
        ],
        options: {
          reduceOptions: { values: false, calcs: ["lastNotNull"] },
          thresholds: {
            steps: [
              { color: "red", value: null },
              { color: "yellow", value: 95 },
              { color: "green", value: 99 }
            ]
          }
        },
        fieldConfig: {
          defaults: {
            unit: "percent",
            min: 0,
            max: 100
          }
        }
      },

      // Error Rate
      {
        title: "Error Rate by Program",
        type: "graph",
        gridPos: { x: 12, y: 4, w: 12, h: 8 },
        targets: [
          {
            expr: 'rate(gridtokenx_transactions_error_total[5m])',
            legendFormat: "{{program}} - {{error_type}}",
            interval: "5s",
            refId: "D"
          }
        ],
        options: {
          legend: { displayMode: "table", placement: "bottom" }
        },
        fieldConfig: {
          defaults: {
            unit: "eps",
            min: 0
          }
        }
      },

      // Memory Usage
      {
        title: "Memory Usage (MB)",
        type: "graph",
        gridPos: { x: 0, y: 8, w: 12, h: 8 },
        targets: [
          {
            expr: 'gridtokenx_memory_usage_bytes / 1024 / 1024',
            legendFormat: "{{instance}}",
            interval: "5s",
            refId: "E"
          }
        ],
        options: {
          legend: { displayMode: "table", placement: "bottom" }
        },
        fieldConfig: {
          defaults: {
            unit: "short",
            min: 0
          }
        }
      },

      // Compute Units Consumption
      {
        title: "Compute Units per Transaction",
        type: "graph",
        gridPos: { x: 0, y: 16, w: 12, h: 8 },
        targets: [
          {
            expr: 'rate(gridtokenx_compute_units_total[5m]) / rate(gridtokenx_transactions_total[5m])',
            legendFormat: "{{program}} - {{operation}}",
            interval: "5s",
            refId: "F"
          }
        ],
        options: {
          legend: { displayMode: "table", placement: "bottom" }
        },
        fieldConfig: {
          defaults: {
            unit: "short",
            min: 0
          }
        }
      },

      // Active Users
      {
        title: "Active Users",
        type: "stat",
        gridPos: { x: 12, y: 12, w: 6, h: 4 },
        targets: [
          {
            expr: 'gridtokenx_active_users_total',
            legendFormat: "Active Users",
            interval: "30s",
            refId: "G"
          }
        ],
        options: {
          reduceOptions: { values: false, calcs: ["lastNotNull"] }
        },
        fieldConfig: {
          defaults: {
            unit: "short",
            min: 0
          }
        }
      },

      // Order Book Size
      {
        title: "Order Book Size",
        type: "stat",
        gridPos: { x: 18, y: 12, w: 6, h: 4 },
        targets: [
          {
            expr: 'gridtokenx_order_book_size_total',
            legendFormat: "Orders",
            interval: "30s",
            refId: "H"
          }
        ],
        options: {
          reduceOptions: { values: false, calcs: ["lastNotNull"] }
        },
        fieldConfig: {
          defaults: {
            unit: "short",
            min: 0
          }
        }
      },

      // Energy Trading Volume
      {
        title: "Energy Trading Volume (kWh)",
        type: "graph",
        gridPos: { x: 12, y: 16, w: 12, h: 8 },
        targets: [
          {
            expr: 'increase(gridtokenx_energy_traded_kwh_total[1h])',
            legendFormat: "{{market}}",
            interval: "1m",
            refId: "I"
          }
        ],
        options: {
          legend: { displayMode: "table", placement: "bottom" }
        },
        fieldConfig: {
          defaults: {
            unit: "kWh",
            min: 0
          }
        }
      }
    ],
    variables: [
      {
        name: "program",
        type: "query",
        query: "label_values(gridtokenx_transaction_duration_seconds_sum, program)",
        current: { selected: false, text: "All", value: "$__all" },
        options: [],
        refresh: 1
      },
      {
        name: "instance",
        type: "query",
        query: "label_values(gridtokenx_memory_usage_bytes, instance)",
        current: { selected: false, text: "All", value: "$__all" },
        options: [],
        refresh: 1
      }
    ]
  };
}

/**
 * Create system health dashboard
 */
export function createSystemHealthDashboard(): DashboardConfig {
  return {
    name: "GridTokenX System Health",
    tags: ["gridtokenx", "health", "system"],
    panels: [
      // System Status Overview
      {
        title: "System Status",
        type: "stat",
        gridPos: { x: 0, y: 0, w: 24, h: 4 },
        targets: [
          {
            expr: 'gridtokenx_system_health',
            legendFormat: "{{status}}",
            interval: "30s",
            refId: "A"
          }
        ],
        options: {
          reduceOptions: { values: false, calcs: ["lastNotNull"] },
          colorMode: "background",
          graphMode: "area",
          justifyMode: "center",
          orientation: "horizontal",
          textMode: "value_and_name",
          thresholds: {
            steps: [
              { color: "red", value: 0 },
              { color: "yellow", value: 1 },
              { color: "green", value: 2 }
            ]
          }
        },
        fieldConfig: {
          defaults: {
            mappings: [
              { options: { 0: { text: "Critical", color: "red" } }, type: "value" },
              { options: { 1: { text: "Warning", color: "yellow" } }, type: "value" },
              { options: { 2: { text: "Healthy", color: "green" } }, type: "value" }
            ]
          }
        }
      },

      // Component Status
      {
        title: "Component Health",
        type: "table",
        gridPos: { x: 0, y: 4, w: 12, h: 10 },
        targets: [
          {
            expr: 'gridtokenx_component_health',
            legendFormat: "{{component}}",
            interval: "30s",
            refId: "B",
            format: "table"
          }
        ],
        options: {
          showHeader: true,
          cellHeight: "sm",
          footer: { show: false, countRows: false, fields: "" }
        },
        fieldConfig: {
          defaults: {
            custom: {
              align: "auto",
              displayMode: "auto"
            },
            mappings: [
              { options: { 0: { text: "DOWN", color: "red" } }, type: "value" },
              { options: { 1: { text: "WARNING", color: "yellow" } }, type: "value" },
              { options: { 2: { text: "UP", color: "green" } }, type: "value" }
            ]
          }
        }
      },

      // Network Connectivity
      {
        title: "Network Latency (ms)",
        type: "graph",
        gridPos: { x: 12, y: 4, w: 12, h: 5 },
        targets: [
          {
            expr: 'gridtokenx_network_latency_seconds * 1000',
            legendFormat: "{{endpoint}}",
            interval: "5s",
            refId: "C"
          }
        ],
        options: {
          legend: { displayMode: "table", placement: "bottom" }
        },
        fieldConfig: {
          defaults: {
            unit: "ms",
            min: 0,
            thresholds: {
              steps: [
                { color: "green", value: null },
                { color: "yellow", value: 100 },
                { color: "red", value: 500 }
              ]
            }
          }
        }
      },

      // Error Log Rate
      {
        title: "Error Rate (errors/min)",
        type: "graph",
        gridPos: { x: 12, y: 9, w: 12, h: 5 },
        targets: [
          {
            expr: 'rate(gridtokenx_error_logs_total[1m]) * 60',
            legendFormat: "{{error_level}}",
            interval: "30s",
            refId: "D"
          }
        ],
        options: {
          legend: { displayMode: "table", placement: "bottom" }
        },
        fieldConfig: {
          defaults: {
            unit: "epm",
            min: 0
          }
        }
      },

      // Resource Utilization
      {
        title: "Resource Utilization",
        type: "graph",
        gridPos: { x: 0, y: 14, w: 24, h: 10 },
        targets: [
          {
            expr: 'gridtokenx_cpu_usage_percent',
            legendFormat: "CPU - {{instance}}",
            interval: "5s",
            refId: "E"
          },
          {
            expr: 'gridtokenx_memory_usage_percent',
            legendFormat: "Memory - {{instance}}",
            interval: "5s",
            refId: "F"
          },
          {
            expr: 'gridtokenx_disk_usage_percent',
            legendFormat: "Disk - {{instance}}",
            interval: "5s",
            refId: "G"
          }
        ],
        options: {
          legend: { displayMode: "table", placement: "bottom" }
        },
        fieldConfig: {
          defaults: {
            unit: "percent",
            min: 0,
            max: 100,
            thresholds: {
              steps: [
                { color: "green", value: null },
                { color: "yellow", value: 70 },
                { color: "red", value: 90 }
              ]
            }
          }
        }
      }
    ]
  };
}

/**
 * Generate dashboard JSON files
 */
export function generateDashboardConfigs(): void {
  const monitoringDir = path.join(process.cwd(), 'monitoring');
  
  // Ensure monitoring directory exists
  if (!fs.existsSync(monitoringDir)) {
    fs.mkdirSync(monitoringDir, { recursive: true });
  }
  
  // Generate performance dashboard
  const perfDashboard = createPerformanceDashboard();
  fs.writeFileSync(
    path.join(monitoringDir, 'performance-dashboard.json'),
    JSON.stringify(perfDashboard, null, 2)
  );
  
  // Generate system health dashboard
  const healthDashboard = createSystemHealthDashboard();
  fs.writeFileSync(
    path.join(monitoringDir, 'system-health-dashboard.json'),
    JSON.stringify(healthDashboard, null, 2)
  );
  
  console.log('✅ Dashboard configurations generated:');
  console.log(`   📊 Performance Dashboard: monitoring/performance-dashboard.json`);
  console.log(`   🏥 System Health Dashboard: monitoring/system-health-dashboard.json`);
}

/**
 * Generate Prometheus configuration
 */
export function generatePrometheusConfig(): void {
  const prometheusConfig = {
    global: {
      scrape_interval: "15s",
      evaluation_interval: "15s"
    },
    rule_files: ["monitoring/alert-rules.yml"],
    alerting: {
      alertmanagers: [
        {
          static_configs: [
            {
              targets: ["localhost:9093"]
            }
          ]
        }
      ]
    },
    scrape_configs: [
      {
        job_name: "gridtokenx",
        static_configs: [
          {
            targets: ["localhost:8080"],
            labels: {
              service: "gridtokenx",
              environment: "production"
            }
          }
        ],
        metrics_path: "/metrics",
        scrape_interval: "5s"
      },
      {
        job_name: "node-exporter",
        static_configs: [
          {
            targets: ["localhost:9100"],
            labels: {
              service: "node-exporter",
              environment: "production"
            }
          }
        ],
        metrics_path: "/metrics",
        scrape_interval: "10s"
      }
    ]
  };
  
  const monitoringDir = path.join(process.cwd(), 'monitoring');
  if (!fs.existsSync(monitoringDir)) {
    fs.mkdirSync(monitoringDir, { recursive: true });
  }
  
  fs.writeFileSync(
    path.join(monitoringDir, 'prometheus.yml'),
    `# GridTokenX Prometheus Configuration
# Generated automatically by dashboard-setup.ts

${JSON.stringify(prometheusConfig, null, 2)}
`
  );
  
  console.log(`📋 Prometheus config generated: monitoring/prometheus.yml`);
}

/**
 * Generate AlertManager configuration
 */
export function generateAlertManagerConfig(): void {
  const alertManagerConfig = {
    global: {
      smtp_smarthost: "localhost:587",
      smtp_from: "alerts@gridtokenx.com",
      smtp_auth_username: "alerts@gridtokenx.com",
      smtp_auth_password: "password"
    },
    route: {
      group_by: ["alertname"],
      group_wait: "10s",
      group_interval: "10s",
      repeat_interval: "1h",
      receiver: "web.hook",
      routes: [
        {
          match: {
            severity: "critical"
          },
          receiver: "critical-alerts"
        },
        {
          match: {
            severity: "warning"
          },
          receiver: "warning-alerts"
        }
      ]
    },
    receivers: [
      {
        name: "web.hook",
        webhook_configs: [
          {
            url: "http://localhost:5001/"
          }
        ]
      },
      {
        name: "critical-alerts",
        email_configs: [
          {
            to: "devops@gridtokenx.com",
            subject: "[CRITICAL] GridTokenX Alert",
            body: `Alert: {{ .Annotations.summary }}
Description: {{ .Annotations.description }}
Labels: {{ range .Labels.SortedPairs }}{{ .Name }}={{ .Value }} {{ end }}`
          }
        ]
      },
      {
        name: "warning-alerts",
        email_configs: [
          {
            to: "devs@gridtokenx.com",
            subject: "[WARNING] GridTokenX Alert",
            body: `Alert: {{ .Annotations.summary }}
Description: {{ .Annotations.description }}
Labels: {{ range .Labels.SortedPairs }}{{ .Name }}={{ .Value }} {{ end }}`
          }
        ]
      }
    ]
  };
  
  const monitoringDir = path.join(process.cwd(), 'monitoring');
  if (!fs.existsSync(monitoringDir)) {
    fs.mkdirSync(monitoringDir, { recursive: true });
  }
  
  fs.writeFileSync(
    path.join(monitoringDir, 'alertmanager.yml'),
    `# GridTokenX AlertManager Configuration
# Generated automatically by dashboard-setup.ts

${JSON.stringify(alertManagerConfig, null, 2)}
`
  );
  
  console.log(`🚨 AlertManager config generated: monitoring/alertmanager.yml`);
}

/**
 * Setup complete monitoring infrastructure
 */
export function setupMonitoringInfrastructure(): void {
  console.log('🚀 Setting up GridTokenX Monitoring Infrastructure');
  console.log('='.repeat(50));
  
  generateDashboardConfigs();
  generatePrometheusConfig();
  generateAlertManagerConfig();
  
  console.log('\n📋 Next Steps:');
  console.log('1. Install Prometheus: brew install prometheus');
  console.log('2. Install Grafana: brew install grafana');
  console.log('3. Install Node Exporter: brew install node_exporter');
  console.log('4. Start services:');
  console.log('   prometheus --config.file=monitoring/prometheus.yml');
  console.log('   grafana-server --config=monitoring/grafana.ini');
  console.log('   node_exporter');
  console.log('5. Import dashboards in Grafana:');
  console.log('   - monitoring/performance-dashboard.json');
  console.log('   - monitoring/system-health-dashboard.json');
  
  console.log('\n🎯 Dashboard URLs:');
  console.log('   Prometheus: http://localhost:9090');
  console.log('   Grafana: http://localhost:3000 (admin/admin)');
  console.log('   Node Exporter: http://localhost:9100/metrics');
  
  console.log('\n✅ Monitoring infrastructure setup complete!');
}

// Run setup if this file is executed directly
if (require.main === module) {
  setupMonitoringInfrastructure();
}
