# GridTokenX Performance Testing Guide

## การแนะนำเบื้องต้น (Introduction)

คู่มือนี้อธิบายวิธีการทดสอบประสิทธิภาพของธุรกรรมบน Solana blockchain สำหรับ GridTokenX project โดยเน้นที่การวัดประสิทธิภาพด้านความเร็ว (Throughput) และความหน่วง (Latency) ของธุรกรรมการโอนโทเคน

## ส่วนประกอบของการทดสอบประสิทธิภาพ (Performance Testing Components)

### 1. Throughput (อัตราการดำเนินการ)
- **คำจำกัด**: จำนวนธุรกรรมที่สามารถดำเนินการได้ในช่วงเวลาหนึ่ง (Transaction Per Second - TPS)
- **วิธีวัด**: นับจำนวนธุรกรรมที่สำเร็จในช่วงเวลาทดสอบ
- **เป้าหมาย**: TPS สูงสุดเท่าที่จะทำได้ โดยไม่ส่งผลกระทบต่อความเสถียรของระบบ

### 2. Latency (ความหน่วง)
- **คำจำกัด**: เวลาที่ใช้ในการประมวลผลและยืนยันธุรกรรม (Transaction Latency)
- **วิธีวัด**: วัดเวลาตั้งแต่เริ่มส่งธุรกรรมจนถึงได้รับการยืนยัน
- **เป้าหมาย**: Latency ต่ำสุดเท่าที่จะทำได้

## การใช้งาน Script ทดสอบประสิทธิภาพ (Using Performance Test Script)

### คำสั่งพื้นฐาน (Basic Command)
```bash
ts-node scripts/loop-transfer-test.ts <iterations> <amount> [delay]
```

### พารามิเตอร์ (Parameters)
- `iterations`: จำนวนครั้งในการโอนโทเคน (Required)
- `amount`: จำนวน GRX ที่จะโอนในแต่ละครั้ง (Required)
- `delay`: หน่วงเวลาหยุดระหว่างธุรกรรม (Optional, default: 100ms)

### ตัวอย่างการใช้งาน (Usage Examples)

#### การทดสอบพื้นฐาน (Basic Test)
```bash
# ทดสอบ 10 ครั้ง โอน 0.5 GRX ต่อครั้ง หน่วงเวลา 500ms
ts-node scripts/loop-transfer-test.ts 10 0.5 500
```

#### การทดสอบปานากา (Medium Load Test)
```bash
# ทดสอบ 50 ครั้ง โอน 1 GRX ต่อครั้ง หน่วงเวลา 200ms
ts-node scripts/loop-transfer-test.ts 50 1 200
```

#### การทดสอบหนัก (High Load Test)
```bash
# ทดสอบ 100 ครั้ง โอน 0.5 GRX ต่อครั้ง หน่วงเวลา 100ms
ts-node scripts/loop-transfer-test.ts 100 0.5 100
```

#### การทดสอบความเครียดขัน (Stress Test)
```bash
# ทดสอบ 500 ครั้ง โอน 0.1 GRX ต่อครั้ง หน่วงเวลา 50ms
ts-node scripts/loop-transfer-test.ts 500 0.1 50
```

## ผลลัพธ์การทดสอบ (Test Results)

### ข้อมูลที่แสดง (Output Information)
- **Transaction Summary**: สรุปจำนวนธุรกรรมทั้งหมด สำเร็จ และล้มเหลว
- **Performance Metrics**: ตัวชี้วัดประสิทธิภาพ
  - Total Time: เวลารวมที่ใช้ในการทดสอบ
  - Average Latency: ค่าเฉลี่ยของ latency (ms)
  - Min/Max Latency: ค่าน้อยสุดและมากสุดของ latency (ms)
  - Throughput: อัตราการดำเนินการ (TPS)
- **Error Details**: รายละเอียดข้อผิดพลาด (ถ้ามี)
- **Balance Verification**: ตรวจสอบยอดคงเหลือก่อนและหลังการทดสอบ

### การประเมินผล (Performance Evaluation)
สคริปต์จะประเมินผลและให้ความเห็นเกี่ยวกับประสิทธิภาพ:

#### Throughput Evaluation
- **Excellent**: >5 TPS
- **Moderate**: 2-5 TPS
- **Low**: <2 TPS

#### Latency Evaluation
- **Excellent**: <500 ms
- **Moderate**: 500-1000 ms
- **High**: >1000 ms

## การเตรียมการทดสอบ (Test Preparation)

### ข้อกำหนดเบื้องต้น (Prerequisites)
1. Solana validator ทำงานอยู่ (Solana validator running)
2. มี token mint ที่สร้างแล้ว (Token mint created)
3. มี wallet 2 ใบที่มี token (Two wallets with tokens)
4. มีสิทธิในการโอน token (Token transfer permissions)

### การเตรียมพร้อม (Setup Commands)
```bash
# สร้าง token ถ้ายังไม่มี
ANCHOR_WALLET=./wallet-2-keypair.json pnpm run token:create

# ทดสอบ setup สำหรับ loop transfer
ANCHOR_WALLET=./wallet-2-keypair.json pnpm run setup:loop-test

# ตรวจสอบ total supply
pnpm run token:total-supply
```

## การวิเคราะห์ปัญหา (Troubleshooting)

### ปัญหาทั่วไป (Common Issues)

#### 1. Transaction Failures
- **สาเหตุ**: ไม่มีพอเพียงพอหรือ connection ขัดข้อง
- **วิธีแก้**: ตรวจสอบยอดคงเหลือและสถานะ validator
```bash
# ตรวจสอบยอด wallet
solana balance ./wallet-1-keypair.json

# ตรวจสอบสถานะ validator
solana cluster-version
```

#### 2. High Latency
- **สาเหตุ**: Network congestion หรือ validator ทำงานช้า
- **วิธีแก้**: เพิ่ม delay ระหว่างธุรกรรมหรือลดจำนวน concurrent transactions

#### 3. Low Throughput
- **สาเหตุ**: Network conditions หรือ configuration ไม่เหมาะสม
- **วิธีแก้**: ปรับ configuration หรือตรวจสอบ hardware resources

### การปรับแต่งค่า (Optimization)

#### การเพิ่ม Throughput
1. ลด delay ระหว่างธุรกรรม
2. เพิ่มจำนวน concurrent transactions (ถ้าสามารถ)
3. ใช้ที่อยู่ที่ใกล้กับ validator

#### การลด Latency
1. ใช้ connection ที่เร็วขึ้น (WebSocket ถ้าเป็นไปได้)
2. ลดขนาดของ transaction
3. ใช้ priority fees สำหรับการประมวลผลเร็วขึ้น

## การบันทึกผล (Saving Results)

สคริปต์จะบันทึกผลการทดสอบลงไฟล์ JSON โดยอัตโนมัติ:
```
performance-results-[timestamp].json
```

ไฟล์นี้ประกอบด้วย:
- ข้อมูลสรุปประสิทธิภาพทั้งหมด
- รายละเอียด latency แต่ละธุรกรรม
- ข้อผิดพลาด (ถ้ามี)
- เวลาที่ใช้ในการทดสอบ

สามารถใช้ไฟล์นี้ในการเปรียบเทียบประสิทธิภาพระหว่างการทดสอบต่างๆ

## การทดสอบแบบอัตโนมัติ (Automated Testing)

### สคริปต์ทดสอบอัตโนมัติ (Automated Test Script)
```bash
#!/bin/bash
# automated-performance-test.sh

echo "=== GridTokenX Automated Performance Testing ==="

# Test 1: Basic Performance
echo "Running Basic Performance Test..."
pnpm run test:loop-transfer-quick

# Test 2: Medium Load
echo "Running Medium Load Test..."
pnpm run test:loop-transfer

# Test 3: Stress Test
echo "Running Stress Test..."
pnpm run test:loop-transfer-stress

echo "=== Performance Testing Complete ==="
```

### การตั้งเวลาทดสอบ (Scheduled Testing)
สามารถใช้ cron job สำหรับการทดสอบประสิทธิภาพตามกำหนดเวลา:
```bash
# ทดสอบประสิทธิภาพทุกวันเวลา 2 โมงเช้า
0 2 * * * /path/to/gridtokenx-anchor/scripts/automated-performance-test.sh >> /path/to/logs/performance.log
```

## การตีความผล (Result Interpretation)

### การเปรียบเทียบผล (Comparing Results)

| Test | Iterations | Amount | Delay | TPS | Avg Latency | Status |
|------|------------|--------|-------|------|--------------|--------|
| Test 1 | 10 | 0.5 GRX | 500ms | 8.5 | 450ms | Excellent |
| Test 2 | 50 | 1.0 GRX | 200ms | 12.3 | 380ms | Excellent |
| Test 3 | 100 | 0.5 GRX | 100ms | 15.7 | 520ms | Moderate |

### การวิเคราะหาแนวโน้ม (Trend Analysis)
- ตรวจสอบ latency ที่เพิ่มขึ้นหรือลดลงตามเวลา
- วิเคราะหาปัจจัยที่ส่งผลกระทบต่อประสิทธิภาพ
- ตรวจสอบความเสถียรของระบบในช่วงเวลานานๆ

## สรุป (Conclusion)

การทดสอบประสิทธิภาพเป็นส่วนสำคัญในการพัฒนาและปรับปรับปรุง GridTokenX project โดยการวัดประสิทธิภาพอย่างสม่ำเสมอจะช่วยให้มั่นใจได้ว่าระบบทำงานได้ตามที่คาดหวัง และสามารถรองรับการใช้งานจริงได้

ข้อแนะนำเพิ่มเติม:
- ทดสอบในสภาพแวดล้อมที่แตกต่างกัน
- บันทึกผลการทดสอบเพื่อการเปรียบเทียบ
- ใช้ข้อมูลการทดสอบในการปรับแต่งระบบ
- ตั้งเป้าหมายประสิทธิภาพที่เหมาะสมกับความต้องการของระบบ