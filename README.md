# ODE

**Instant insight. Zero setup.**

ODE is a lightweight web app that automatically explores CSV and Excel files and surfaces:
- key dataset stats
- clean, relevant charts
- potential data quality issues
- quick, human-readable insights

No dashboards to configure. No charts to wire up. Just upload a file and explore.

Live app: https://ode-data-engine.vercel.app

---

## What ODE Does

Upload a CSV or Excel file and ODE will automatically:

- Detect rows, columns, missing values
- Infer column types (numeric, categorical, date, ID-like)
- Generate **curated charts** (not chart spam)
- Flag potential outliers or risky distributions
- Answer natural-language questions like:
  - *“What stands out?”*
  - *“Top values by column”*
  - *“Any missing data issues?”*
  - *“Time trends”*

ODE is designed for **fast first-look analysis**, not enterprise BI.

---

## Why ODE Exists

I built ODE because I was tired of repeating the same setup every time I opened a new dataset:

- import → inspect → profile → chart → sanity-check → repeat

ODE compresses that workflow into **one upload**.

> This is not meant to replace tools like Power BI or Tableau.  
> It’s meant to get you oriented **before** you open them.

---

## Tech Stack

- **Next.js (App Router)**
- **TypeScript**
- **Tailwind CSS**
- **Recharts**
- **PWA support** (installable as an app)
- Deployed on **Vercel**

---

## Getting Started (Local)

```bash
git clone https://github.com/ofilemfetane10/ode-data-engine.git
cd ode-data-engine

---

## Supported Files

- `.csv`
- `.xlsx`

Files are processed **in-browser**.  
Nothing is uploaded to a server or stored.

---

##  Install as an App

ODE supports **PWA installation** on supported browsers.

- **Desktop:** Click **Install ODE** in the header
- **Mobile:** Use **“Add to Home Screen”**

---

## Current Limitations

- Very large files may be slow (client-side processing)
- Insight generation is heuristic-based (not ML… yet)
- This is an early version — UI and logic will evolve

---

##  Status

**Early / experimental. Free to use.**

Feedback is very welcome.

---

## Feedback & Issues

If you find bugs, edge cases, or have feature ideas:

 https://github.com/ofilemfetane10/ode-data-engine/issues

---

## Disclosure

I built this tool.


npm run dev
