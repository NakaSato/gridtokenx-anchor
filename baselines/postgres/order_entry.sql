-- pgbench script: order-entry analog of trading.create_buy_order.
-- One INSERT per transaction (1 kWh @ 4.00, matching the λ-ramp order-entry bench).
\set uid random(1, :naccounts)
INSERT INTO baseline.orders(usr, side, amount, price)
VALUES (:uid, 'buy', 1000000000, 4000000);
