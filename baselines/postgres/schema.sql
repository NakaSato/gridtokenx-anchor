-- Centralized-Postgres baseline for the GridTokenX settlement layer.
-- Mirrors the LOGICAL work of the on-chain trading path — order entry and
-- off-chain-match settlement bookkeeping — in a single trusted RDBMS, with NO
-- consensus, NO signature verification, NO PDA rent. The gap between this and the
-- on-chain TPS is the "cost of decentralization" (blockchain tax) for the same
-- operation. Objects live in schema `baseline` inside the dev `gridtokenx` DB.

DROP SCHEMA IF EXISTS baseline CASCADE;
CREATE SCHEMA baseline;

-- Per-user escrow balances (THBG currency + energy), the analog of the on-chain
-- per-user escrow PDAs the settlement debits/credits.
CREATE TABLE baseline.accounts (
  id            integer PRIMARY KEY,
  thbg_balance  bigint NOT NULL,   -- 6-dec currency base units
  energy_balance bigint NOT NULL   -- 9-dec atomic kWh
);

-- Fee / wheeling / loss collectors (the three global writable accounts that
-- serialize on-chain settlement — here just three rows, no lock ceiling).
CREATE TABLE baseline.collectors (
  kind    text PRIMARY KEY,
  balance bigint NOT NULL DEFAULT 0
);
INSERT INTO baseline.collectors(kind, balance) VALUES ('fee',0),('wheeling',0),('loss',0);

-- Order book (order-entry analog of create_buy_order / create_sell_order).
CREATE TABLE baseline.orders (
  id     bigserial PRIMARY KEY,
  usr    integer NOT NULL,
  side   text    NOT NULL,
  amount bigint  NOT NULL,
  price  bigint  NOT NULL,
  status text    NOT NULL DEFAULT 'active',
  ts     timestamptz NOT NULL DEFAULT now()
);

-- Settled trades (TradeRecord analog).
CREATE TABLE baseline.trades (
  id          bigserial PRIMARY KEY,
  buyer       integer NOT NULL,
  seller      integer NOT NULL,
  amount      bigint  NOT NULL,
  price       bigint  NOT NULL,
  total_value bigint  NOT NULL,
  fee         bigint  NOT NULL,
  wheeling    bigint  NOT NULL,
  loss        bigint  NOT NULL,
  ts          timestamptz NOT NULL DEFAULT now()
);

-- Replay guard (OrderNullifier / TradeNullifier analog): a settlement that reuses
-- a nullifier aborts on the PK conflict, exactly as the on-chain init would fail.
CREATE TABLE baseline.nullifiers (
  id bigint PRIMARY KEY
);

-- Seed N accounts with astronomically high balances so a multi-second run never
-- underflows (throughput measurement, not solvency). :naccounts passed by runner.
INSERT INTO baseline.accounts(id, thbg_balance, energy_balance)
SELECT g, 1000000000000000000, 1000000000000000000
FROM generate_series(1, :naccounts) AS g;
