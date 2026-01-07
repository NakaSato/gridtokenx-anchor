# TPC-Benchmark Program

**Program ID:** `6m4qnVFJF3HAz7QNjW73EuXzy37r5dUzh7Zey5A9JHPr`

This program implements the **TPC-C** (Transaction Processing Performance Council - C) benchmark, the industry standard for measuring On-Line Transaction Processing (OLTP) performance. It has been adapted for Solana's account model.

## Data Model & Constants

The relational tables of TPC-C are mapped to Solana Accounts (PDAs).

**Scaling parameters**:
- $W$: Number of Warehouses (Scale Factor).
- $D = 10$: Districts per Warehouse.
- $C = 3000$: Customers per District.
- $I = 100,000$: Items (fixed).

| TPC-C Table | PDA Seed Structure | Note |
|-------------|-------------------|------|
| WAREHOUSE   | `["warehouse", w_id]` | Root entity. |
| DISTRICT    | `["district", w_id, d_id]` | 10 per Warehouse. |
| CUSTOMER    | `["customer", w_id, d_id, c_id]` | 3,000 per District. |
| ITEM        | `["item", i_id]` | 100,000 fixed items. |
| STOCK       | `["stock", w_id, i_id]` | Inventory for each item in each warehouse. |
| ORDER       | `["order", w_id, d_id, o_id]` | Order header + lines. |
| NEW_ORDER   | `["new_order", w_id, d_id, o_id]` | Short-term tracking for processing. |
| HISTORY     | `["history", w_id, d_id, h_id]` | Payment history log. |

## Transactions Mix

The benchmark executes a specific mix of transactions, defined by the TPC-C specification v5.11:

1.  **New-Order (45%)**
    - **Logic**: Creates a new order for a customer.
    - **Complexity**: Read/Update `DISTRICT`, `WAREHOUSE`, `CUSTOMER`. Insert `ORDER`, `NEW_ORDER`. Update $5..15$ `STOCK` items.
    - **Contention**: High on `DISTRICT.next_o_id`.

2.  **Payment (43%)**
    - **Logic**: Customer pays for an order.
    - **Complexity**: Update `WAREHOUSE.ytd`, `DISTRICT.ytd`, `CUSTOMER.balance`. Insert `HISTORY`.
    - **Contention**: Update locks on Warehouse/District.

3.  **Order-Status (4%)**
    - **Logic**: Query status of customer's last order.
    - **Complexity**: Read `CUSTOMER`, Read `ORDER`.

4.  **Delivery (4%)**
    - **Logic**: Process a batch of 10 new orders (one per district).
    - **Complexity**: Delete `NEW_ORDER`, Update `ORDER.carrier_id`, Update `CUSTOMER.balance`.

5.  **Stock-Level (4%)**
    - **Logic**: Analyze stock levels of recently sold items.
    - **Complexity**: Join `ORDER_LINE` and `STOCK`. Heaviest read transaction.

## Configuration
- **Districts per Warehouse**: 10
- **Customers per District**: 3000
- **Items**: 100,000
- **Remote Order Probability**: 1%
- **PoA Mode**: Optimized for Permissioned use (fixed validator set).
