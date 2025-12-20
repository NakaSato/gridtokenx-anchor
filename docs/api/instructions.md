# Instructions Reference

Detailed instruction reference for GridTokenX programs.

## Energy Token Instructions

### initialize

```typescript
await program.methods
  .initialize("Grid Energy Token", "GRID")
  .accounts({
    mint: mintPda,
    tokenInfo: tokenInfoPda,
    authority: authority.publicKey,
    payer: payer.publicKey,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([authority])
  .rpc();
```

### mint_to_wallet

```typescript
await program.methods
  .mintToWallet(new BN(amount))
  .accounts({
    mint: mintPda,
    destination: destinationAta,
    destinationOwner: owner.publicKey,
    authority: authority.publicKey,
    payer: payer.publicKey,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([authority])
  .rpc();
```

## Trading Instructions

### create_buy_order

```typescript
await program.methods
  .createBuyOrder(new BN(amount), new BN(price))
  .accounts({
    market: marketPda,
    order: orderPda,
    authority: buyer.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([buyer])
  .rpc();
```

### create_sell_order

```typescript
await program.methods
  .createSellOrder(new BN(amount), new BN(price))
  .accounts({
    market: marketPda,
    order: orderPda,
    authority: seller.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([seller])
  .rpc();
```

## Registry Instructions

### register_prosumer

```typescript
await program.methods
  .registerProsumer("Alice", { prosumer: {} })
  .accounts({
    prosumer: prosumerPda,
    owner: wallet.publicKey,
    payer: payer.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([wallet])
  .rpc();
```

## Oracle Instructions

### update_price

```typescript
await program.methods
  .updatePrice(new BN(price))
  .accounts({
    feed: feedPda,
    authority: oracleAuthority.publicKey,
  })
  .signers([oracleAuthority])
  .rpc();
```
