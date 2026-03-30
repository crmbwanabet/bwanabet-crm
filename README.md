# BwanaBet CRM System v1

A comprehensive customer relationship management platform for BwanaBet, a Zambian online sports betting and casino operator. The CRM provides player analytics, churn prediction, AI-powered outbound calling, affiliate agent management, fraud detection, and a bonus decision engine — all in a single-page application backed by Supabase.

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Deployment](#deployment)
- [Environment Variables](#environment-variables)
- [Authentication & Roles](#authentication--roles)
- [Database Schema (Supabase)](#database-schema-supabase)
- [API Endpoints (Vercel Serverless)](#api-endpoints-vercel-serverless)
- [Frontend Structure](#frontend-structure)
- [Tabs & Features](#tabs--features)
  - [Dashboard](#1-dashboard)
  - [Profitability](#2-profitability)
  - [Behavior](#3-behavior)
  - [Churn](#4-churn)
  - [Analytics](#5-analytics)
  - [Players](#6-players)
  - [Call Center](#7-call-center)
  - [Agents](#8-agents)
  - [Fraud](#9-fraud)
  - [Bonuses](#10-bonuses)
  - [Settings](#11-settings)
- [Player Data Model](#player-data-model)
- [Churn Scoring Algorithm](#churn-scoring-algorithm)
- [Bonus Decision Engine](#bonus-decision-engine)
- [Voice Agent Integration](#voice-agent-integration)
- [Internationalization](#internationalization)
- [Keyboard Shortcuts & Command Palette](#keyboard-shortcuts--command-palette)
- [AI Chat Widget](#ai-chat-widget)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Vercel (Frontend)                       │
│  index.html ──── Single-page app (Tailwind + vanilla JS)   │
│  api/config.js ─ Returns Supabase URL & anon key           │
│  api/customers.js ── Authenticated bulk player import API  │
│  api/va.js ───── Reverse proxy to voice agent server       │
│  api/va/scripts/[id].js ── Script proxy                    │
└──────────┬──────────────────────┬───────────────────────────┘
           │                      │
           ▼                      ▼
┌──────────────────┐   ┌──────────────────────────────┐
│    Supabase      │   │  Voice Agent Server (EC2)    │
│  (eu-west-1)     │   │  13.246.211.152 (af-south-1) │
│                  │   │                              │
│  - Auth          │   │  server.py (FastAPI/Python)  │
│  - PostgreSQL    │   │  FreeSWITCH + Deepgram       │
│  - 20+ tables    │   │  Groq/Claude LLM             │
│  - RLS policies  │   │  ElevenLabs TTS              │
└──────────────────┘   └──────────────────────────────┘
```

The CRM frontend communicates directly with Supabase for all data operations (player data, agents, call logs, chat, fraud scores, bonus decisions). Voice agent operations (campaigns, scripts, calls, outcomes) are proxied through Vercel serverless functions to the EC2 voice agent server.

---

## Tech Stack

### Frontend
| Library | Version | Purpose |
|---------|---------|---------|
| Tailwind CSS | CDN (latest) | Utility-first styling |
| Lucide Icons | 0.344.0 | Icon system (200+ icons) |
| Supabase JS | v2 | Database client, auth, real-time subscriptions |
| Chart.js | 4.4.1 | Doughnut, bar, and line charts |
| SheetJS (xlsx) | 0.18.5 | Excel file parsing for imports |
| Inter Font | Google Fonts | Typography |

### Backend
| Component | Purpose |
|-----------|---------|
| Vercel | Hosting, serverless API functions |
| Supabase | PostgreSQL database, authentication, row-level security |
| Voice Agent (EC2) | FreeSWITCH telephony, Deepgram STT, Groq/Claude LLM, ElevenLabs TTS |

---

## Deployment

The CRM is hosted on **Vercel** and auto-deploys on push to `main`.

```
Push to main → Vercel builds → index.html + api/ deployed
```

The GitHub Actions workflow (`.github/workflows/deploy.yml`) deploys only `server.py` to the EC2 voice agent server — it does **not** deploy the CRM frontend.

### Manual Deployment
No build step required. `index.html` is served as-is. Vercel serverless functions in `api/` are auto-detected.

---

## Environment Variables

### Vercel Environment
| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous (public) API key |
| `CRM_API_KEY` | API key for authenticated `/api/customers` endpoint |

### Voice Agent Server (.env)
| Variable | Description |
|----------|-------------|
| `DEEPGRAM_API_KEY` | Speech-to-text API key |
| `LLM_API_KEY` | Claude API key |
| `GROQ_API_KEY` | Groq API key for Llama model |
| `ELEVENLABS_API_KEY` | Text-to-speech API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase service role key |

---

## Authentication & Roles

Authentication uses **Supabase Auth** (email/password). After authentication, the user's role is looked up from the `crm_users` table.

### Roles

| Role | Access | Navigation | Header |
|------|--------|------------|--------|
| `admin` | All tabs | Full nav visible | "BWANABET" + Admin badge (yellow) |
| `developer` | All tabs | Full nav visible | "BWANABET" + Developer badge (purple) |
| `callcenter` | Call Center tab only | Nav hidden | "BWANABET Call Center" (blue badge) |
| `affiliate_manager` | Agents tab only | Nav hidden | "BWANABET Agent Program" (green badge) |

### Role-Specific Behavior
- **callcenter**: Sees only the Call Center tab. No search, parameters, AI widget, or other tabs. Can log calls, view queue, manage call outcomes.
- **affiliate_manager**: Sees only the Agents tab. Has an agent filter bar to toggle between "My Agents" (filtered by recruiter name) and "All Agents". Can manage agents, upload activity, process payments, view tiers.
- **admin/developer**: Full access to all 11 tabs, AI widget, command palette, parameter editing, user management.

### Sub-Tab Visibility
- **Team** sub-tab (Agents): Visible to admin, developer, affiliate_manager
- **Chat** sub-tab (Agents): Visible to admin, developer, affiliate_manager
- **Admin Panel** sub-tab (Call Center): Visible to admin, developer only

---

## Database Schema (Supabase)

### Core Tables

#### `customers` (90,964 rows)
Primary player data table. Each row represents a BwanaBet player.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (PK) | Player ID from BwanaBet platform |
| `phone_number` | TEXT | Player phone (260xxxxxxxxx or "virtual") |
| `registration_date` | DATE | Account creation date |
| `last_activity` | DATE | Most recent platform activity |
| `sport_bet_amount` | NUMERIC | Total sports betting volume (K) |
| `sport_win_amount` | NUMERIC | Total sports winnings (K) |
| `sport_bet_count` | INTEGER | Number of sports bets placed |
| `sport_win_count` | INTEGER | Number of sports bets won |
| `casino_bet_amount` | NUMERIC | Total casino wagering (K) |
| `casino_win_amount` | NUMERIC | Total casino winnings (K) |
| `casino_bet_count` | INTEGER | Number of casino bets |
| `casino_win_count` | INTEGER | Number of casino wins |
| `deposit_amount` | NUMERIC | Lifetime deposits (K) |
| `deposit_count` | INTEGER | Number of deposits |
| `withdrawal_amount` | NUMERIC | Lifetime withdrawals (K) |
| `withdrawal_count` | INTEGER | Number of withdrawals |
| `bonus_amount` | NUMERIC | Total bonuses received (K) |
| `first_deposit_amount` | NUMERIC | First deposit value |
| `currency` | TEXT | Currency code (default: ZMW) |
| `status` | TEXT | Account status |
| `agent_code` | TEXT | Referral agent promo code |
| `created_at` | TIMESTAMPTZ | Row creation timestamp |
| `last_import_at` | TIMESTAMPTZ | Last data import timestamp |

#### `crm_users`
CRM system users (login accounts).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | User ID |
| `email` | TEXT | Login email |
| `name` | TEXT | Display name |
| `role` | TEXT | admin, developer, callcenter, affiliate_manager |
| `is_active` | BOOLEAN | Account active status |
| `created_at` | TIMESTAMPTZ | Account creation |

#### `call_logs`
Call center call records.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Log entry ID |
| `client_id` | TEXT | Player ID called |
| `employee_id` | TEXT | CRM user who made the call |
| `outcome` | TEXT | interested, not_interested, no_answer, callback, wrong_number |
| `notes` | TEXT | Call notes |
| `rating` | INTEGER | Call quality rating (1-5) |
| `callback_date` | DATE | Scheduled callback date |
| `created_at` | TIMESTAMPTZ | Call timestamp |

### Agent/Affiliate Tables

#### `agents`
Affiliate agents who refer players.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Agent ID |
| `promo_code` | TEXT (UNIQUE) | Agent's referral code |
| `name` | TEXT | Full name |
| `phone` | TEXT | Phone number |
| `email` | TEXT | Email address |
| `commission_plan` | TEXT | per_client, loss_based, or nil |
| `commission_rate` | NUMERIC | Loss-based commission percentage |
| `per_client_amount` | NUMERIC | Per-client commission amount |
| `location` | TEXT | Agent location |
| `recruiter_name` | TEXT | Who recruited this agent |
| `status` | TEXT | pending, active, inactive |
| `is_active` | BOOLEAN | Active flag |
| `promo_code_change_request` | TEXT | Requested new promo code |
| `promo_code_change_status` | TEXT | approved, rejected, null |
| `created_at` | TIMESTAMPTZ | Registration date |

#### `agent_player_activity`
Per-agent per-player weekly performance data.

| Column | Type | Description |
|--------|------|-------------|
| `agent_id` | UUID | Agent reference |
| `agent_code` | TEXT | Agent promo code |
| `week_start_date` | DATE | Week start |
| `week_end_date` | DATE | Week end |
| `user_id` | TEXT | Player ID |
| `phone_number` | TEXT | Player phone |
| `first_deposit` | NUMERIC | Player's first deposit |
| `total_deposit` | NUMERIC | Total deposits this week |
| `total_bet_sports` | NUMERIC | Sports bets this week |
| `total_bet_casino` | NUMERIC | Casino bets this week |
| `total_bet` | NUMERIC | Total bets this week |
| `losses` | NUMERIC | Player losses this week |
| `qualifies_per_client` | BOOLEAN | Meets per-client qualification |
| `commission_earned` | NUMERIC | Commission for this player |

Upsert key: `agent_id, user_id, week_start_date`

#### `agent_weekly_data`
Aggregated weekly agent performance.

| Column | Type | Description |
|--------|------|-------------|
| `agent_id` | UUID | Agent reference |
| `week_start_date` | DATE | Week start |
| `total_clients` | INTEGER | Total referred players |
| `qualifying_clients` | INTEGER | Players meeting qualification criteria |
| `total_losses` | NUMERIC | Total player losses |
| `total_earnings` | NUMERIC | Agent commission earned |

#### `agent_payments`
Commission payment records.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Payment ID |
| `agent_id` | UUID | Agent reference |
| `amount` | NUMERIC | Payment amount |
| `payment_method` | TEXT | Payment method |
| `payment_date` | DATE | Payment date |
| `status` | TEXT | pending, paid, cancelled |
| `notes` | TEXT | Payment notes |
| `paid_at` | TIMESTAMPTZ | Actual payment timestamp |
| `created_at` | TIMESTAMPTZ | Record creation |

#### `commission_tiers`
Commission tier definitions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Tier ID |
| `tier_name` | TEXT | Bronze, Silver, Gold, Platinum |
| `tier_order` | INTEGER | Sort order |
| `emoji` | TEXT | Display emoji |
| `min_active_clients` | INTEGER | Minimum qualifying clients |
| `loss_based_rate` | NUMERIC | Loss-based commission % |
| `per_client_amount` | NUMERIC | Per-client commission (K) |
| `cash_prize` | NUMERIC | Tier promotion prize (K) |
| `color` | TEXT | UI color class |

Default tiers:
| Tier | Min Clients | Loss Rate | Per Client | Prize |
|------|-------------|-----------|------------|-------|
| Bronze | 7 | 20% | K100 | K500 |
| Silver | 14 | 30% | K150 | K1,500 |
| Gold | 21 | 40% | K200 | K3,000 |
| Platinum | 28 | 50% | K250 | K5,000 |

#### `tier_promotions`
Records of agents reaching new commission tiers.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Promotion ID |
| `agent_id` | UUID | Agent reference |
| `tier_name` | TEXT | Tier reached |
| `qualifying_clients` | INTEGER | Clients at promotion time |
| `cash_prize` | NUMERIC | Prize amount |
| `prize_status` | TEXT | pending, paid, skipped |
| `paid_at` | TIMESTAMPTZ | When prize was paid |
| `notes` | TEXT | Admin notes |
| `promoted_at` | TIMESTAMPTZ | Promotion timestamp |

### Voice Agent Tables

#### `va_scripts`
Voice agent call scripts.

#### `va_blacklist`
Phone numbers blocked from voice agent calls.

#### `va_call_outcomes`
Call outcome records from voice agent campaigns (callback, take_action, no_action, no_answer, blacklist).

#### `va_settings`
Voice agent configuration (voice ID, call settings).

#### `va_fillers`
Filler phrases for natural conversation flow during AI calls.

### Bonus Decision Engine Tables

#### `bonus_decisions`
Audit trail of all bonus decisions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Decision ID |
| `player_id` | TEXT | Player reference |
| `phone_number` | TEXT | Player phone |
| `action` | TEXT | do_nothing, reminder, bonus, deposit_booster, cashback, vip_perk, restriction |
| `bonus_amount` | DECIMAL(12,2) | Bonus value |
| `expected_deposit` | DECIMAL(12,2) | Expected deposit from player |
| `ev` | DECIMAL(12,2) | Expected value of decision |
| `p_deposit` | DECIMAL(5,4) | Probability of deposit |
| `trigger_reason` | TEXT | Why this action was recommended |
| `previous_churn_status` | TEXT | Churn status before change |
| `new_churn_status` | TEXT | Current churn status |
| `status` | TEXT | pending, approved, executed, expired, rejected |
| `negative_signals` | JSONB | Array of detected signals |
| `actual_revenue` | DECIMAL(12,2) | Actual revenue (post-execution) |
| `decided_by` | TEXT | Email of approver |
| `decided_at` | TIMESTAMPTZ | Decision timestamp |
| `created_at` | TIMESTAMPTZ | Record creation |
| `updated_at` | TIMESTAMPTZ | Last update |

#### `bonus_settings`
Engine configuration (key-value with JSONB values).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Row ID |
| `key` | TEXT (UNIQUE) | Setting key (e.g., "config") |
| `value` | JSONB | Configuration object |
| `updated_by` | TEXT | Last editor email |
| `updated_at` | TIMESTAMPTZ | Last update |

#### `bonus_negative_signals`
Per-player negative signal tracking.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Signal ID |
| `player_id` | TEXT | Player reference |
| `signal_type` | TEXT | hard or soft |
| `signal_name` | TEXT | Signal identifier |
| `details` | JSONB | Signal details |
| `is_active` | BOOLEAN | Whether signal is current |
| `detected_at` | TIMESTAMPTZ | Detection timestamp |

### Other Tables

#### `fraud_risk_scores`
Fraud detection results with risk scores and levels.

#### `fraud_flags`
Individual fraud flags per player.

#### `chat_messages`
Internal CRM team chat messages.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Message ID |
| `agent_id` | UUID | Conversation partner (agent) |
| `sender_type` | TEXT | "crm" or "agent" |
| `sender_id` | TEXT | Sender email |
| `sender_name` | TEXT | Display name |
| `message` | TEXT | Message content |
| `is_read` | BOOLEAN | Read status |
| `created_at` | TIMESTAMPTZ | Send timestamp |

#### `telegram_subscribers`
Telegram notification recipients.

#### `email_imports` / `email_import_data`
Email-based data import tracking.

#### `uptime_checks` / `uptime_incidents` / `uptime_config`
Service uptime monitoring.

---

## API Endpoints (Vercel Serverless)

### `GET /api/config`
Returns Supabase connection parameters for the frontend.

**Response:**
```json
{
  "supabaseUrl": "https://xxx.supabase.co",
  "supabaseAnonKey": "eyJ..."
}
```

No authentication required. CORS enabled.

### `POST /api/customers`
Bulk upsert player records into the `customers` table.

**Headers:** `x-api-key: <CRM_API_KEY>`

**Request Body:**
```json
{
  "players": [
    {
      "id": "12345",
      "phone_number": "260971234567",
      "deposit_amount": 5000,
      "sport_bet_amount": 3000,
      ...
    }
  ]
}
```

- Accepts up to 5,000 records per request
- Processes in batches of 1,000
- Normalizes phone numbers (digits only)
- Converts numeric fields from strings
- Sets default currency to ZMW
- Whitelisted fields only (rejects unknown columns)

**Response:**
```json
{
  "success": true,
  "upserted": 5000,
  "errors": []
}
```

### `GET /api/customers`
Query player records with filtering and pagination.

**Headers:** `x-api-key: <CRM_API_KEY>`

**Query Parameters:**
| Param | Description |
|-------|-------------|
| `id` | Filter by player ID |
| `phone` | Filter by phone number |
| `status` | Filter by account status |
| `limit` | Results per page (default: 100, max: 1000) |
| `offset` | Pagination offset |

### `ALL /api/va?path=<endpoint>`
Reverse proxy to the voice agent server at `http://13.246.211.152:8080/api/<path>`.

Forwards method, headers, and body. Returns response with original Content-Type. Returns 502 if voice agent server is unreachable.

### `ALL /api/va/scripts/[id]`
Reverse proxy for voice agent script CRUD operations. Routes to `http://13.246.211.152:8080/api/scripts/<id>`.

---

## Frontend Structure

The entire CRM frontend is a single `index.html` file (~12,000 lines, ~770KB). It contains:

1. **CSS** — Custom styles + Tailwind utility classes
2. **HTML** — Login screen, main app shell, 11 tab content areas, 8+ modals
3. **JavaScript** — Application logic organized as module objects:
   - `App` — Global state (players, filters, settings, user)
   - `CallCenter` — Call queue, logging, employee management
   - `AgentManager` — Affiliate program management
   - `BonusEngine` — Bonus decision engine (Constitution v2.0)
   - `FraudPanel` — Fraud detection display
   - `AIAgent` — AI chat widget
   - `ChatManager` — Internal team chat
   - `TelegramManager` — Telegram notification integration

### External Libraries (CDN)
All libraries are loaded from CDN — no build step, no node_modules:
- Tailwind CSS (runtime JIT)
- Lucide Icons 0.344.0
- Supabase JS v2
- Chart.js 4.4.1
- SheetJS (xlsx) 0.18.5
- Google Fonts (Inter 400-800)

---

## Tabs & Features

### 1. Dashboard

The main overview tab showing high-level KPIs and distribution charts.

#### KPI Cards (clickable — navigate to Players tab with filter)
- **Total Players** — Count of all players in the database
- **Profitable Players** — Players where company netRevenue > 0 (player lost more than won)
- **Negative GGR Players** — Players where company netRevenue < 0 (player won more than lost)
- **At Risk** — Players with high or critical churn risk

#### Financial Overview
- **Total Deposits** — Sum of all player deposits (K)
- **Total Withdrawals** — Sum of all player withdrawals (K)
- **Net Revenue (GGR)** — Gross Gaming Revenue = Total Bets - Total Wins

#### Charts
- **Profitability Distribution** — Doughnut chart (Profitable vs Negative GGR vs Break Even)
- **Churn Risk Distribution** — Doughnut chart (Low / Medium / High / Critical)

#### Quick Segments (clickable cards)
- **Value Segments** — VIP (K5k+), High (K1k-5k), Medium (K100-1k), Low (<K100)
- **Player Preferences** — Sports Bettors, Casino Players, Mixed Players
- **Churn Risk** — Critical, High, Medium, Low (with value-at-risk amounts)
- **Alerts** — Withdrawing Profits, Virtual Phone, High Win Rate (>60%)

---

### 2. Profitability

Detailed profitability analysis with two views.

#### Profitability Overview
- Count and total amount for profitable vs negative GGR players
- Explanation: "Lost more than won = Company profit" / "Won more than lost = Company loss"

#### Win Rate Distribution
- **0-25%** — Most Profitable (player rarely wins)
- **25-40%** — Profitable
- **40-50%** — Break Even
- **50%+** — Negative GGR (player wins more than half)

#### Charts
- **Profitability Distribution** — Doughnut (Most Profitable / Profitable / Break Even / Negative GGR)
- **Win Rate Distribution** — Bar chart showing player count per bucket

---

### 3. Behavior

Player behavior analysis across two dimensions.

#### Betting Styles
- **High Rollers** — Average bet > K100
- **Regular Bettors** — Average bet K10-K100
- **Casual Players** — Average bet < K10

#### Lifecycle Stages
- **New** — Registered < 30 days ago
- **Growing** — Active, < 50 total bets
- **Mature** — Active, 50+ total bets
- **Declining** — Last active 14-30 days ago
- **Dormant** — Last active 30-60 days ago
- **Churned** — Last active 60+ days ago

#### Charts
- **Betting Style** — Doughnut chart
- **Lifecycle** — Bar chart

---

### 4. Churn

Churn risk analysis and monitoring.

#### Risk Level Cards
- **Critical** — Score ≥ 70 or inactive 30+ days
- **High** — Score ≥ 50 or inactive 14-30 days
- **Medium** — Score ≥ 30 or inactive 7-14 days
- **Low** — Score < 30 and active within 7 days

Each card shows player count and total value at risk (K).

#### Charts
- **Churn Distribution** — Doughnut chart by risk level
- **Churn Score Distribution** — Bar chart showing score ranges (0-20, 21-40, 41-60, 61-80, 81-100)

---

### 5. Analytics

Period-over-period comparison and advanced analytics.

#### Comparison Presets
- Last 7 days vs Previous 7
- Last 14 days vs Previous 14
- Last 30 days vs Previous 30
- Last 90 days vs Previous 90
- Custom date range (4 date pickers)

#### Comparison Metrics (8 cards showing period 1 vs period 2 with % change)
- New Players
- Total Deposits
- Total Withdrawals
- Net GGR
- Average Deposit
- Average Win Rate
- VIP Players
- At Risk Players

#### Charts
- **Revenue Comparison** — Bar chart (Deposits / Withdrawals / GGR for each period)
- **Segment Comparison** — Bar chart (player counts by segment for each period)

#### Detailed Breakdown Table
Metrics with Period 1 value, Period 2 value, absolute change, percentage change, and trend indicator (↑ green / ↓ red / → gray).

#### LTV Distribution
- Bar chart showing player count across LTV tiers (< K0, K0-1k, K1k-10k, K10k+)

#### Segment Comparison Tool
- Two dropdown selectors to compare any two segments side-by-side
- Shows: player count, avg deposit, avg win rate, avg churn score

---

### 6. Players

Full player management with data table, filtering, bulk operations, and player lists.

#### Player List Tiles (6 cards at top)
| List | Criteria | Color |
|------|----------|-------|
| Active | Deposited in last 30 days | Green |
| Inactive | No deposit in 31-90 days | Amber |
| Dormant | No deposit in 91-180 days | Orange |
| Churned | No deposit in 180+ days | Red |
| New | Registered in last 30 days | Blue |
| VIP | Value segment = VIP | Purple |

Each tile shows count and has buttons: "View" (filter table), "Campaign" (send to voice agent).

#### Filters Sidebar
- **Search** — Filter by player ID or phone number (debounced 300ms)
- **Profitability** — All / Profitable / Negative GGR
- **Preference** — All / Sports / Casino / Mixed
- **Churn Risk** — All / Low / Medium / High / Critical
- **Value Segment** — All / VIP / High / Medium / Low
- **Saved Filters** — Save/load/delete filter presets (localStorage)
- **Watchlist** — Favorited players for quick access
- **Recently Viewed** — Last 10 viewed players

#### Players Table
Sortable, paginated table (100 per page) with columns:
| Column | Description | Toggleable |
|--------|-------------|------------|
| Checkbox | Bulk selection | No |
| ID | Player ID | Yes |
| Phone | Phone number + type badge (Real/Virtual) | No |
| Type | Phone type | Yes |
| Preference | Sports/Casino/Mixed badge | Yes |
| Revenue | Net revenue (K) with profit/loss coloring | Yes |
| Win Rate | Win percentage with progress bar | Yes |
| Value | VIP/High/Medium/Low badge | Yes |
| Churn | Risk level badge + score | Yes |
| LTV | Lifetime value estimate (K) | Yes |
| Actions | View + Watchlist quick actions | No |

#### Column Visibility
Dropdown menu to show/hide table columns. Preferences saved to localStorage.

#### Bulk Operations Toolbar
Appears when players are selected:
- **Select All** — Select all visible players
- **Clear** — Deselect all
- **Add to Watchlist** — Bulk add to favorites
- **Export** — Export selected to CSV
- **Run Campaign** — Send selected players to voice agent

#### Auto-Refresh
Toggle to automatically reload player data every 5 minutes (15 minutes for datasets > 10,000 players).

#### Player Detail Modal
Clicking "View" on a player opens a detailed modal showing:
- Player ID, phone, registration date, last activity
- Financial summary (deposits, withdrawals, net revenue, win rate)
- Value segment, betting style, lifecycle stage
- Churn score with contributing factors
- LTV estimate and optimal bonus recommendation
- Similar players (5 most similar by revenue + win rate + preference)
- AI-generated insights

#### Export
- Export filtered players to CSV
- Export all players to CSV
- Filename includes filter name and date

---

### 7. Call Center

Three sub-tabs: **Calls**, **AI Call Agent**, **Admin Panel**.

#### 7a. Calls Sub-Tab

Manual call queue and logging system for call center employees.

**Employee Selection:**
- Dropdown of active callcenter-role users
- Employee stats: Total calls, Successful, Failed, Callbacks, Success Rate

**Call Queue:**
- Built from players with medium+ churn risk
- Priority scoring: Critical (+100), High (+50), Medium (+20), Callback pending (+200), New (+10)
- Filters: All, Critical, High, Callback, New
- Shows max 100 items with overflow count
- Excludes "no_contact" (5+ no-answer) and already contacted players

**Active Call Panel:**
When a client is selected from the queue:
- Player info card with churn badge, phone (copy button), registration date, last deposit
- Call attempt counter (X/5 — after 5 no-answers, marked "no_contact")
- Outcome buttons: Interested, Not Interested, No Answer, Callback, Wrong Number
- Rating stars (1-5)
- Notes textarea
- Call history for this player (last 5 calls)

**My Call History:**
- Last 10 calls by current employee
- Shows outcome badge, player ID, date

#### 7b. AI Call Agent Sub-Tab

Full voice agent campaign management with 7 sub-panels:

**Overview Panel:**
- Server health status (online/offline indicator, version)
- Active calls count
- Stats cards: Total Calls, Successful, Callbacks, Actions Pending
- Recent calls with transcript previews
- Email import status banner

**Campaigns Panel:**
- Campaign name input
- Script selection dropdown (loaded from server)
- Calls per minute slider
- Schedule toggle (set future launch time with countdown)
- Contact list: paste phone numbers OR upload CSV/Excel file
- Saved contact lists (localStorage, max 20)
- Launch/Schedule button
- Active campaigns list with: status, progress bar, pause/resume/stop buttons
- Campaign history with: outcome breakdown, re-run and re-run-no-answer buttons

**Script Builder Panel:**
Two modes:
- **Library** — Grid of saved scripts with edit/delete/set-default/duplicate
- **Builder** — Create/edit scripts with:
  - Script name
  - **Guided mode**: Company name, agent name, call purpose, two offers (name + details), how to claim, tone selector, max response words, currency format, silence nudge, not-interested goodbye, cannot-help goodbye
  - **Freewrite mode**: Full script textarea
  - Voice settings: voice picker, voice ID, stability/similarity/style/speed sliders
  - Knowledge base textarea (additional context for LLM)
  - Set as default checkbox
  - Preview panel showing compiled script

**Filler Phrases Panel:**
- Per-script filler phrases with categories (neutral, thinking, acknowledging)
- Add new fillers with phrase text and category
- Toggle individual fillers on/off
- Delete fillers
- Fillers provide natural conversation flow during LLM processing time

**Test Call Panel (Modal):**
- Phone number input
- Script selector
- Start test call button
- Live transcript display (WebSocket)
- Post-call analysis display

**Live Monitor Panel:**
- Real-time active call grid showing: phone, duration, turn count, status
- Refreshes every 10 seconds

**Outcome Lists Panel:**
Five outcome categories from voice agent calls:

| Category | Description | Color |
|----------|-------------|-------|
| Callback | Player wants to be called back | Blue |
| Take Action | Player showed interest, needs follow-up | Green |
| Blacklist | Player requested no more calls | Red |
| No Action | No actionable outcome | Gray |
| No Answer | Call not answered | Amber |

Each list features:
- Campaign filter dropdown
- Phone search
- Date range filter (presets: today, 7d, 30d, 90d, all + custom)
- Actioned/unactioned filter
- Bulk select with mass delete/move/mark-done
- Individual record detail modal showing: phone, outcome, bonus details, call summary, transcript, non-English detection
- Export to CSV or Excel
- Reclassify (move record to different category)

**Voice Settings Panel:**
- Voice picker (preview voices)
- Voice ID input
- Stability, similarity, style sliders
- Call settings: max concurrent calls, call timeout, max turns, greeting delay, endpointing, max silence count
- Server URL configuration with connection test

**Campaign Tracker Sidebar:**
- Collapsible side panel showing active campaign progress
- Real-time outcome counters
- Progress bar with percentage
- Auto-refreshes every 5 seconds during active campaigns

#### 7c. Admin Panel Sub-Tab

**User Management:**
- Add new call center users (name, email, password, role)
- Users table with edit/deactivate/delete actions
- Role assignment (callcenter, admin, developer, affiliate_manager)

**Performance Overview:**
- Date filter: All Time, Today, This Week, This Month
- Summary stats: Total Calls, Successful, Failed, Avg Success Rate
- Employee performance table: Name, Email, Role, Total Calls, Successful, Rate %, Avg Rating
- Export admin report to CSV
- Click employee name to view full call history modal

---

### 8. Agents

Affiliate agent management with 8 sub-tabs.

#### 8a. Overview
- **Trend Cards** — This week vs last week: Clients (↑↓%), Losses, Earnings, New Agents (30d)
- **Trend Chart** — 8-week line chart with dual Y-axes (Earnings K + Client count)
- **Key Metrics** — Total Agents, Pending Approvals, Total Signups, Total Losses, Amount Owed
- **Commission Plans** — Count by plan: Plan A (Per Client), Plan B (Loss Based), Plan C (Nil)
- **Leaderboards** — Top 10 by: Clients, Losses, Earnings

#### 8b. Approvals
- Pending agent activation requests (approve/reject)
- Promo code change requests (approve/reject)

#### 8c. Manage Agents
- **Add Agent Form**: Promo code, password, name, phone, email, commission plan, location, recruiter
- **Agent Table**: Searchable, filterable by plan (All/Per Client/Loss Based/Nil)
  - Shows: promo code, name, plan, tier badge, status, total clients, earnings, balance
  - Actions: Edit, Activate/Deactivate, Delete
- **Edit Agent Modal**: All fields editable, commission plan change tracking

#### 8d. Upload
- **Upload Agent List**: Excel file with columns: Username, Agent Name, Source, Telephone, NRC, Location, Recruiter, Date, Percent, Code, Link
  - Auto-determines commission plan from percent value
  - Sanitizes promo codes (Cyrillic→Latin conversion)
  - Default or custom password assignment
- **Upload Player Activity**: Excel file with weekly player data
  - Columns: Agent Code, User ID, Phone, First Deposit, Total Deposit, Bet Sports, Bet Casino, Total Bet, Losses
  - Qualification logic: totalDeposit ≥ 100 AND (betSports ≥ 100 OR betCasino ≥ 100)
  - Auto-calculates commissions per plan and tier
  - Checks for tier promotions
  - Sends Telegram notification with summary
- **Download Templates**: CSV templates for both upload types

#### 8e. Payments
- Agent selector (filters out nil-plan agents)
- Current balance display (earnings - paid)
- Record payment form: amount, method, date, notes
- Payment history table with status filter (All/Pending/Paid/Cancelled)
- Mark as Paid / Cancel payment actions
- Export payments to CSV

#### 8f. Tiers
- Editable tier cards showing: tier name, emoji, min clients, loss rate %, per-client amount, cash prize
- Tier promotions list: agent name, tier reached, qualifying clients, prize amount
  - Actions: Edit prize amount, Mark paid (with Telegram notification), Skip prize
- Only admin/developer/affiliate_manager can edit

#### 8g. Team
- Team member management (affiliate_manager and agent roles)
- Add new team members with Supabase Auth signup
- Toggle active/inactive
- Change role between affiliate_manager and agent

#### 8h. Chat
- Internal messaging between CRM users and agents
- Conversation list showing active agents (searchable)
- Message thread with sender identification
- Real-time updates via Supabase subscription
- Agent messages (left, dark bubble) vs CRM messages (right, light bubble)

---

### 9. Fraud

Fraud detection display panel.

#### Summary Cards
- Total Flagged players
- Critical risk count
- High risk count
- Medium risk count

#### Filters
- Risk Level: All / Critical / High / Medium / Low
- Status: All / Flagged / Cleared

#### Flagged Players Table
- Player ID, phone, risk score, risk level, flag details
- Actions: Clear flag, Delete record
- Color-coded risk levels

Data sourced from `fraud_risk_scores` table (populated by external `fraud_scanner.py` on the voice agent server).

---

### 10. Bonuses

Bonus Decision Engine implementing Constitution v2.0. Determines optimal bonus allocation to maximize player LTV through ROI-driven decisions.

#### Core Principle
> "Bonuses are not rewards. They are investments in player behavior."

#### Sub-Tabs

**Overview:**
- KPI Cards: Recommendations count, Projected EV, Bonus Budget, Negative Signals (hard + soft)
- Action Distribution: Bar chart showing % breakdown by action type
- Bonus Efficiency: Executed count, Total Spent, Efficiency ratio (Net Revenue / Bonus Cost)
- Constitution Rules Reference: ROI formula, bonus cap, trigger system
- "Run Engine" button — processes all players and generates recommendations

**Recommendations:**
- Filterable table of all player recommendations
- Filter by action type: All, Bonus, Deposit Booster, Cashback, VIP Perk, Reminder, Restriction
- Table columns: Player (ID + phone), Churn (badge + score), P(Deposit) %, Expected Deposit, Action badge, Bonus Amount, EV, Reason
- Actions per row: Approve (saves as "approved"), Reject (saves as "rejected")
- Pagination (50 per page)

**Negative Signals:**
- **Hard Signals** (red) — Require restriction/blocking:
  - Immediate withdrawal after wagering (withdrawal > 90% of deposits)
  - Bonus abuse loops (bonus > 50% of deposits)
- **Soft Signals** (amber) — Reduce/pause bonuses:
  - No activity after bonus (30+ days inactive despite bonuses)
  - Bonus dependency (bonus/deposit ratio > 30%)

**Audit Trail:**
- Full history of all bonus decisions
- Filter by status: All, Pending, Approved, Executed, Rejected
- Table: Date, Player, Action, Bonus Amount, EV, Status, Decided By, Actions
- Pending decisions can be approved/rejected; approved decisions can be executed
- Pagination (50 per page)

**Settings:**
- House Margin % (default: 5%)
- Max Bonus % of Expected Deposit (default: 20% — constitutional limit)
- Risk Adjustment Base (default: 10%)
- P(Deposit|Bonus) Weights with live total:
  - Recency: 0.25
  - Frequency: 0.20
  - Monetary: 0.20
  - Bonus Responsiveness: 0.20
  - Churn Risk: 0.15
- Save / Reset to Defaults buttons
- Settings persisted to `bonus_settings` Supabase table

---

### 11. Settings

#### User Account
- Current user email display

#### Import Players
- File upload (CSV/Excel) for bulk player data import
- Field mapping supporting multiple column name aliases
- "Update existing players" checkbox for upsert behavior
- Supports Excel serial date parsing
- Progress indicator during import
- Import summary with counts and errors

#### Analysis Parameters Display
- Current win rate thresholds
- Current value segment thresholds
- Current churn risk day thresholds

#### Parameters Modal (accessible from header button)
- **Profitability Parameters**: Win rate thresholds for Most Profitable, Profitable, Negative GGR
- **Value Segment Parameters**: Revenue thresholds for VIP, High, Medium (K)
- **Betting Style Parameters**: Avg bet thresholds for High Roller, Casual
- **Lifecycle Parameters**: Days for "New Player" classification
- **Churn Risk Parameters**: Days thresholds for Low, Medium, High risk levels
- **Churn Score Weights**: Inactivity (35), Withdrawal (20), Frequency (15), Win Rate (10), Value (5) — should sum to ~85
- Save & Apply / Reset to Default buttons
- All changes trigger full player reprocessing

#### Telegram Alerts
- Chat ID and label input
- Connected subscribers list
- Subscribe/unsubscribe management

---

## Player Data Model

When players are loaded from the `customers` table, each player is processed through `processPlayer()` which enriches the raw data with computed fields:

### Computed Fields

| Field | Formula | Description |
|-------|---------|-------------|
| `totalBet` | sportBet + casinoBet | Total wagering volume |
| `totalWin` | sportWin + casinoWin | Total winnings |
| `totalBetCount` | sportBetCount + casinoBetCount | Total number of bets |
| `totalWinCount` | sportWinCount + casinoWinCount | Total winning bets |
| `netRevenue` | totalBet - totalWin | Company GGR (positive = company profit) |
| `winRate` | totalWinCount / totalBetCount × 100 | Player win percentage |
| `isProfitable` | netRevenue > 0 | Company makes money on this player |
| `isNegativeGGR` | netRevenue < 0 | Company loses money on this player |
| `phoneType` | "virtual" or "real" | Based on phone field content |
| `preference` | "sports", "casino", or "mixed" | >70% of bets in one category = specialist |
| `valueSegment` | "vip", "high", "medium", "low" | Based on absolute net revenue vs thresholds |
| `daysSinceRegistration` | (now - registration_date) / 86400000 | Account age in days |
| `daysSinceActivity` | (now - last_activity) / 86400000 | Inactivity period |
| `avgBetSize` | totalBet / totalBetCount | Average wager amount |
| `bettingStyle` | "highroller", "regular", "casual" | Based on avgBetSize vs thresholds |
| `lifecycle` | "new", "growing", "mature", "declining", "dormant", "churned" | Based on age + activity + bet count |
| `churnScore` | 0-100 | Weighted composite risk score |
| `churnRisk` | "low", "medium", "high", "critical" | Risk classification |
| `churnFactors` | string[] | Contributing risk factors |
| `ltv` | dailyValue × 365 × (1 - churnProb × 0.5) | Lifetime value estimate |
| `optimalBonus` | min(ltv × churnProb × 0.15, 500) | Simple bonus recommendation |
| `isWithdrawing` | withdrawal_amount > deposit_amount | Net withdrawal flag |

---

## Churn Scoring Algorithm

The churn score is a weighted composite (0-100) calculated from five factors:

### Factors & Weights

| Factor | Weight | Calculation |
|--------|--------|-------------|
| **Inactivity** | 35 | `min(daysSinceActivity / 60, 1) × 35` |
| **Withdrawal Ratio** | 20 | Triggered when withdrawals > 80% of deposits. Score: `20 × min((ratio - 0.8) × 2, 1)` |
| **Frequency Decline** | 15 | When bets/day < 0.1: `15 × min((0.1 - betsPerDay) / 0.1, 1)`. Zero bets = full 15. |
| **Win Rate** | 10 | Triggered when win rate > 60% AND withdrawal ratio > 50%. Full 10 points. |
| **Value at Risk** | 5 | Triggered when player is VIP segment. Full 5 points. |

### Risk Levels

| Level | Condition |
|-------|-----------|
| **Critical** | Inactive > 30 days OR score ≥ 70 |
| **High** | Inactive > 14 days OR score ≥ 50 |
| **Medium** | Inactive > 7 days OR score ≥ 30 |
| **Low** | Everything else |

### LTV Calculation
```
dailyValue = netRevenue / daysSinceRegistration
ltv = dailyValue × 365 × (1 - churnProbability × 0.5)
```
Where `churnProbability = churnScore / 100`.

---

## Bonus Decision Engine

Implements the Bonus Decision Engine Constitution v2.0.

### ROI Formula
```
EV = (P(Deposit) × Expected Deposit × Margin) − Bonus Cost − Risk Adjustment
```

Where:
- `P(Deposit)` = Probability of player depositing after bonus (see below)
- `Expected Deposit` = Player's average deposit amount
- `Margin` = House margin on deposits (default: 5%)
- `Risk Adjustment` = `riskAdjBase × bonusCost × (churnScore / 100)`

### Probability Model: P(Deposit | Bonus)

Five-factor weighted model:

| Factor | Weight | Calculation | Range |
|--------|--------|-------------|-------|
| Recency | 0.25 | `max(0, 1 - daysSinceActivity / 180)` | 0-1 |
| Frequency | 0.20 | `min(1, totalBetCount / 500)` | 0-1 |
| Monetary | 0.20 | `min(1, depositAmount / 10000)` | 0-1 |
| Bonus Responsiveness | 0.20 | `min(1, depositAmount / bonusAmount / 10)` or 0.3 if no history | 0-1 |
| Churn Risk | 0.15 | `1 - (churnScore / 100)` | 0-1 |

### Bonus Cap Rule
```
Bonus ≤ 20% of Expected Deposit AND must be EV-positive
```

The optimal bonus is found via binary search (20 iterations) for the maximum amount where EV > 0, capped at 20% of expected deposit.

### Next Best Action Hierarchy

The engine evaluates players in this order and returns the first matching action:

| Priority | Action | Condition | Cost |
|----------|--------|-----------|------|
| 1 | **Restriction** | Hard negative signals detected | K0 |
| 2 | **Do Nothing** | Low churn risk + P(Deposit) > 0.6 | K0 |
| 3 | **Reminder** | Medium churn + P(Deposit) > 0.4 | K0 |
| 4 | **VIP Perk** | VIP segment + high/critical churn | Calculated |
| 5 | **Deposit Booster** | EV-positive + expected deposit > K500 | Calculated |
| 6 | **Bonus** | EV-positive + expected deposit ≤ K500 | Calculated |
| 7 | **Cashback** | Soft signals + P(Deposit) > 0.2 | min(expDep × 5%, K100) |
| 8 | **Do Nothing** | No ROI-positive action available | K0 |

### Negative Signals

**Hard Signals** (trigger Restriction):
- **Immediate withdrawal after wagering**: Withdrawals > 90% of deposits while having received bonuses
- **Bonus abuse loops**: Bonus amount > 50% of total deposits

**Soft Signals** (trigger caution):
- **No activity after bonus**: 30+ days inactive despite having received bonuses
- **Bonus dependency**: Bonus/deposit ratio > 30%

### Performance Metric
```
Bonus Efficiency = Net Revenue / Bonus Cost
```
Tracked across all executed decisions in the audit trail.

### Approval Workflow
1. Engine generates recommendations (status: analyzed, not yet persisted)
2. Admin approves → saved to `bonus_decisions` with status "approved"
3. Admin executes → status updated to "executed"
4. Or admin rejects → status "rejected"
5. All decisions logged with timestamp, deciding user, and full context

---

## Voice Agent Integration

The CRM integrates with a separate voice agent server running on EC2 (13.246.211.152). Communication is proxied through Vercel serverless functions.

### Voice Agent API Endpoints (via `/api/va?path=`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `voice/status` | GET | Server health + active call count |
| `calls/recent` | GET | Recent call list |
| `campaign/start` | POST | Launch outbound campaign |
| `campaign/list` | GET | Active campaigns |
| `campaign/pause/{id}` | POST | Pause campaign |
| `campaign/resume/{id}` | POST | Resume campaign |
| `campaign/stop/{id}` | POST | Stop campaign |
| `campaigns/history` | GET | Historical campaigns with outcomes |
| `campaign/continue-info/{uuid}` | GET | Get campaign continuation info |
| `campaign/continue/{uuid}` | POST | Continue incomplete campaign |
| `scripts` | GET | List all scripts |
| `scripts/{id}` | GET/POST/PATCH/DELETE | Script CRUD |
| `outcomes/callback` | GET | Callback outcome records |
| `outcomes/take_action` | GET | Action-needed records |
| `outcomes/no_action` | GET | No-action records |
| `outcomes/no_answer` | GET | Unanswered call records |
| `outcomes/blacklist` | GET | Blacklisted records |
| `outcomes/batch/delete` | POST | Bulk delete outcomes |
| `outcomes/batch/move` | POST | Bulk move between categories |
| `fillers/{script_id}` | GET/POST/DELETE | Filler phrase management |
| `voice/prepare/{id}` | POST | Prepare voice for script |
| `email-imports` | GET | Email import status |

### Call Flow
```
CRM (Vercel) → api/va.js proxy → Voice Agent (EC2:8080)
                                      ↓
                                  FreeSWITCH → Phone call
                                      ↓
                                  mod_audio_stream → WebSocket (8082)
                                      ↓
                                  Deepgram STT → Text
                                      ↓
                                  [Play filler audio]
                                      ↓
                                  Groq/Claude LLM → Response
                                      ↓
                                  ElevenLabs TTS → Audio → Phone
```

### Transcript Storage
- Stored in browser localStorage (key: `va_transcripts_v1`)
- 24-hour TTL by default, "keep" flag for permanent storage
- Messages stored as `{role: 'user'|'assistant', content: string}`

---

## Internationalization

The CRM supports two languages: **English** and **Russian**.

Language toggle in header switches all translatable text via `data-translate` attributes. The TRANSLATIONS constant contains full EN and RU dictionaries covering:
- Navigation labels
- Dashboard metrics
- Financial terms
- Player segment names
- Churn risk levels
- Parameter descriptions
- Data comparison labels
- Efficiency feature labels

Language preference saved to localStorage.

---

## Keyboard Shortcuts & Command Palette

### Command Palette
Activated via search button in header. Provides quick navigation:
- Type to search across tabs and features
- Click result to navigate directly

### Keyboard Shortcuts
- **Enter** on login password field → Submit login
- Tab navigation via numbered keyboard shortcuts (referenced in command palette)

---

## AI Chat Widget

Floating chat widget (bottom-right corner, amber button) providing AI-powered player analysis. Available to admin and developer roles only.

### Capabilities
- Natural language queries against player data
- Player search by ID or characteristics
- Similar player discovery
- Churn prediction explanations (score, risk level, LTV, recommended bonus, contributing factors)
- Segment comparisons
- Proactive alerts on data anomalies

### UI
- Floating action button with notification dot for alerts
- Expandable chat panel (420×550px)
- Message bubbles: user (amber, right) / assistant (white, left)
- Quick action suggestion buttons
- Typing indicator animation
- Conversation history maintained in session

### Proactive Analysis
On initialization, the AI widget runs `runProactiveAnalysis()` to detect anomalies and surfaces relevant alerts as the welcome message.
