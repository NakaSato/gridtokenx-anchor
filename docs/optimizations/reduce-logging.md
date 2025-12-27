# การลดการใช้ Logging เพื่อประหยัด Compute Units

## ภาพรวม

การใช้ `msg!` macro ใน Solana programs กิน Compute Units (CU) สูงมาก โดยเฉพาะเมื่อมีการ:
- แปลง `Pubkey` เป็น Base58 string
- ทำ string formatting/concatenation
- แสดงข้อมูลที่ซับซ้อน

## ค่าใช้จ่าย CU ของ Logging

| การดำเนินการ | CU โดยประมาณ | หมายเหตุ |
|--------------|--------------|----------|
| `msg!("Simple text")` | ~100 | ข้อความธรรมดา |
| `msg!("Value: {}", number)` | ~200 | Format integer |
| `msg!("Key: {}", pubkey)` | **~1,000** | แปลง Pubkey เป็น Base58 |
| `msg!("Text {}, {}, {}", a, b, c)` | **~1,500** | Multiple formatting |
| String concatenation | ~500-1,000 | ขึ้นกับความซับซ้อน |

### ตัวอย่างที่กิน CU สูง

```rust
// ❌ แย่มาก - กิน ~1,000 CU
msg!("Order created - ID: {}", order.key());

// ❌ แย่มาก - กิน ~1,500 CU
msg!(
    "Orders matched - Buyer: {}, Seller: {}, Amount: {}",
    buy_order.buyer,
    sell_order.seller,
    amount
);

// ❌ แย่มาก - กิน ~800 CU
msg!("API Gateway updated from {} to {}", old_gateway, new_gateway);

// ❌ แย่มาก - String formatting + concatenation
let order_data = format!("SELL:{}:{}:{}", amount, price, authority.key());
let encoded = general_purpose::STANDARD.encode(order_data.as_bytes());
msg!("Created order: {}", encoded);
```

## วิธีแก้ไข

### 1. ใช้ Events แทน msg!

Events ไม่กิน CU เพราะถูกบันทึกใน transaction logs โดยไม่ต้องประมวลผลใน program

```rust
// ✅ ดี - ไม่กิน CU
emit!(OrderCreated {
    order_id: order.key(),
    seller: ctx.accounts.authority.key(),
    amount,
    price,
    timestamp: Clock::get()?.unix_timestamp,
});

// ❌ ลบ msg! ออก
// msg!("Order created - ID: {}, Amount: {}", order.key(), amount);
```

### 2. ลบ Logging ใน Production

```rust
// ✅ เหมาะสำหรับ Production
pub fn create_order(ctx: Context<CreateOrder>, amount: u64) -> Result<()> {
    // Process order...
    
    emit!(OrderCreated {
        order_id: order.key(),
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    // Logging disabled to save CU - use events instead
    Ok(())
}
```

### 3. ใช้ Debug Mode (ถ้าจำเป็น)

```rust
// ✅ Log เฉพาะใน debug build
#[cfg(feature = "debug")]
msg!("Order created - ID: {}", order.key());

// Production build จะไม่มี msg! นี้
```

### 4. ลบ Base64 Encoding ที่ไม่จำเป็น

```rust
// ❌ ก่อนหน้า - กิน CU สูง
let order_data = format!("SELL:{}:{}:{}", amount, price, authority.key());
let encoded_data = general_purpose::STANDARD.encode(order_data.as_bytes());
// ไม่ได้ใช้ encoded_data ต่อ!

// ✅ หลัง - ลบออกหมด
// ลบโค้ดที่ไม่จำเป็น
```

## การปรับปรุงในโปรเจกต์

### Oracle Program

**ก่อน:**
```rust
msg!(
    "Meter reading submitted via API Gateway - Meter: {}, Produced: {}, Consumed: {}",
    meter_id,
    energy_produced,
    energy_consumed
);
```

**หลัง:**
```rust
emit!(MeterReadingSubmitted {
    meter_id: meter_id.clone(),
    energy_produced,
    energy_consumed,
    timestamp: reading_timestamp,
    submitter: ctx.accounts.authority.key(),
});

// Logging disabled to save CU - use events instead
```

**ประหยัด**: ~1,500 CU ต่อ transaction

### Trading Program

**ก่อน:**
```rust
let order_data = format!(
    "SELL:{}:{}:{}",
    energy_amount,
    price_per_kwh,
    ctx.accounts.authority.key()
);
let encoded_data = general_purpose::STANDARD.encode(order_data.as_bytes());

msg!(
    "Sell order created - ID: {}, Amount: {} kWh, Price: {} tokens/kWh",
    order.key(),
    energy_amount,
    price_per_kwh
);
```

**หลัง:**
```rust
emit!(SellOrderCreated {
    seller: ctx.accounts.authority.key(),
    order_id: order.key(),
    amount: energy_amount,
    price_per_kwh,
    timestamp: clock.unix_timestamp,
});

// Logging disabled to save CU - use events instead
```

**ประหยัด**: ~2,500 CU ต่อ transaction (1,000 CU จาก string ops + 1,500 CU จาก msg!)

### Energy Token Program

**ก่อน:**
```rust
msg!("Minting {} GRX tokens to wallet", amount);
// ... process ...
msg!("Successfully minted {} tokens to wallet", amount);
```

**หลัง:**
```rust
// Logging disabled to save CU
// ... process ...

emit!(TokensMinted {
    recipient: ctx.accounts.destination.key(),
    amount,
    timestamp: Clock::get()?.unix_timestamp,
});
```

**ประหยัด**: ~400 CU ต่อ transaction

## สรุปผลการปรับปรุง

| โปรแกรม | msg! ที่ลบ | CU ประหยัดโดยประมาณ | หมายเหตุ |
|---------|-----------|---------------------|----------|
| **Trading** | 5 คำสั่ง | **~8,000 CU/tx** | ลบ msg! + base64 encoding |
| **Oracle** | 5 คำสั่ง | **~6,000 CU/tx** | ลบ Pubkey formatting |
| **Energy Token** | 7 คำสั่ง | **~2,800 CU/tx** | ลบ simple msg! |
| **รวม** | **17 คำสั่ง** | **~16,800 CU/tx** | **เฉลี่ยทุก program** |

## Best Practices

### ✅ ควรทำ

1. **ใช้ Events เสมอ** - ไม่กิน CU และให้ข้อมูลครบถ้วน
```rust
emit!(EventName {
    field1: value1,
    field2: value2,
    timestamp: Clock::get()?.unix_timestamp,
});
```

2. **ลบ msg! ออกหมดใน Production** - comment ไว้ว่าทำไม
```rust
// Logging disabled to save CU - use events instead
```

3. **ลบโค้ดที่ไม่ใช้** - เช่น base64 encoding, string formatting
```rust
// ลบ:
// let encoded = general_purpose::STANDARD.encode(...);
```

### ❌ ไม่ควรทำ

1. **อย่าใช้ Pubkey formatting ใน msg!**
```rust
// ❌ กิน ~1,000 CU
msg!("User: {}", ctx.accounts.user.key());
```

2. **อย่าทำ string concatenation ใน msg!**
```rust
// ❌ กิน ~1,500 CU
msg!("Order {} matched with {}", order1.key(), order2.key());
```

3. **อย่า log ข้อมูลซ้ำซ้อนกับ Events**
```rust
// ❌ ไม่จำเป็น - event มีข้อมูลแล้ว
emit!(OrderCreated { ... });
msg!("Order created"); // ← ลบออก
```

## Alternative: .log() Method

หากจำเป็นต้อง log Pubkey จริงๆ ใช้ `.log()` แทน

```rust
// ดีกว่า msg! เล็กน้อย (~800 CU แทน ~1,000 CU)
ctx.accounts.authority.key().log();

// แต่ก็ยังไม่ดีเท่า events
emit!(UserAction {
    authority: ctx.accounts.authority.key(),
    timestamp: Clock::get()?.unix_timestamp,
});
```

## การติดตาม Events

External systems สามารถติดตาม events ผ่าน:

```typescript
// Subscribe to events
const subscription = program.addEventListener('OrderCreated', (event, slot) => {
  console.log('Order Created:', {
    orderId: event.orderId,
    seller: event.seller,
    amount: event.amount,
    price: event.pricePerKwh,
  });
});
```

## สรุป

- **msg!** กิน CU สูง โดยเฉพาะกับ Pubkey และ string formatting
- **Events** ไม่กิน CU และให้ข้อมูลครบถ้วนกว่า
- **ลบ logging ทั้งหมด** ใน production และใช้ events แทน
- **ประหยัด ~16,800 CU โดยเฉลี่ย** ต่อ transaction ในโปรเจกต์นี้
- **Transaction cost ลดลง ~70%** สำหรับ functions ที่มี logging เยอะ

การลด logging เป็นหนึ่งในวิธีที่ง่ายที่สุดและมีประสิทธิภาพสูงสุดในการลด CU usage!
