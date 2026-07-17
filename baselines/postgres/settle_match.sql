-- pgbench script: settlement analog of trading.settle_offchain_match.
-- One ATOMIC transaction doing the same bookkeeping the on-chain settle does —
-- replay-guard insert, buyer debit, seller credit (net), three collector credits,
-- trade record — but with NO Ed25519 verify, NO token-program CPI, NO global-write
-- lock. Fixed 1 kWh @ 4.00 with the paper tariff (25 bps fee, 5 bps loss, 1.15/kWh
-- wheeling), so charges are constants:
--   total_value = 1e9 * 4e6 / 1e9        = 4_000_000
--   fee         = 4_000_000 * 25 / 10000 =    10_000
--   wheeling    = 1e9 * 1_150_000 / 1e9  = 1_150_000
--   loss        = 4_000_000 *  5 / 10000 =     2_000
--   net(seller) = 4_000_000 - the above  = 2_838_000
\set buyer  random(1, :naccounts)
\set seller random(1, :naccounts)
\set nf     random(1, 2000000000)
BEGIN;
INSERT INTO baseline.nullifiers(id) VALUES (:nf);            -- replay guard (PK abort on reuse)
UPDATE baseline.accounts SET thbg_balance = thbg_balance - 4000000 WHERE id = :buyer;
UPDATE baseline.accounts SET thbg_balance = thbg_balance + 2838000 WHERE id = :seller;
UPDATE baseline.collectors SET balance = balance + 10000   WHERE kind = 'fee';
UPDATE baseline.collectors SET balance = balance + 1150000 WHERE kind = 'wheeling';
UPDATE baseline.collectors SET balance = balance + 2000    WHERE kind = 'loss';
INSERT INTO baseline.trades(buyer, seller, amount, price, total_value, fee, wheeling, loss)
VALUES (:buyer, :seller, 1000000000, 4000000, 4000000, 10000, 1150000, 2000);
COMMIT;
