# Media Explorer

A self-contained, browser-based explorer for social media post datasets exported from Junkipedia as CSV. No server, no dependencies to install — open the file and drop your data in.

## Getting started

1. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge).
2. Drag and drop your CSV export onto the drop zone, or click it to browse for the file.
3. The file is parsed entirely in the browser — nothing is uploaded anywhere.

## Expected CSV format

The tool expects a CSV with the following column headers (standard export format from the monitoring platform):

| Column | Description |
|---|---|
| `PostId` | Unique post identifier |
| `ChannelName` | Account / channel name |
| `Platform` | `Telegram`, `TikTok`, `Facebook`, or `YouTube` |
| `published_at` | ISO 8601 timestamp |
| `post_body_text` | Post text content |
| `PostUrl` | Direct link to the post |
| `ViewsCount` | View count |
| `LikesCount` | Like count |
| `SharesCount` | Share / repost count |
| `CommentsCount` | Comment count |

Rows missing a `PostId` are skipped. All other columns are optional.

## Features

### Filters (sidebar)
- **Channel** — select a single channel from a dropdown populated from the data
- **Platform** — multi-select toggle: pick one or more of Telegram, TikTok, Facebook, YouTube
- **Date range** — filter by start and/or end date
- **Keyword search** — searches the post body text; supports a one-click Latin → Cyrillic transliteration for Romanised search terms
- **Text posts only** — hide media-only posts with no body text
- **Reset filters** — clears all active filters at once

### Charts (collapsible panels)
- **Trending** — top 25 hashtags or keywords across the current filtered set (up to 5,000 posts sampled); click a bar to filter by that term
- **Posts over time** — line chart with auto-selected bucket size (hourly → monthly) based on the date range in view
- **Linked domains** — top 20 domains extracted from URLs in post bodies; click a bar to filter posts mentioning that domain

All charts update automatically when filters change.

### Post table
- Sortable by date, views, likes, shares, or comments
- 50 posts per page with pagination
- Click any row to open a detail modal with the full post text, engagement stats, and a link to the original post

### Other
- Dark / light theme toggle (preference saved in browser)

## Files

| File | Purpose |
|---|---|
| `index.html` | App markup and layout |
| `explorer.js` | All application logic (Alpine.js component) |
| `app.css` | Theming and component styles |

All third-party libraries (Alpine.js, Chart.js, PapaParse, Tailwind) are loaded from CDN. An internet connection is required on first load; once cached by the browser, the app works offline.
