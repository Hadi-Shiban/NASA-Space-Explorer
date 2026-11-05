# The Lucid Universe: NASA Space Explorer

Project 7 for Web Development. A web app that shows NASA's Astronomy Picture of the Day (APOD) for a date range the user picks, presented as a full-screen, slow exploration of each photo.

**Live site:** https://hadi-shiban.github.io/NASA-Space-Explorer/

## What it does

- **Date range search.** Open **Dates**, pick a start and end date (June 16, 1995 to today, up to 31 days), and click **Get Space Images**.
- **Gallery.** Open **Gallery** to see every result with its image, title and date. Hovering a card zooms the image.
- **Modal.** Clicking a gallery card (or **Read about this image**, or **Info**) opens a details view with a larger image, the full title and date, NASA's explanation, credits, and links to the original article and full-resolution file.
- **Loading message.** "🔄 Loading space photos…" shows while data loads.
- **Videos.** NASA video files play with controls (never autoplay). YouTube entries show a poster and play only when asked. Anything else gets a clear link.
- **Did You Know?** A random space fact appears above the gallery and briefly on screen after you enter.
- **Viewing modes.** Immersive (fills the screen, move the cursor to look around), Original (whole photo, nothing cropped), and Explore (scroll or pinch to zoom, drag to pan).
- **Discover.** A random day, or six random days, from the whole archive.
- Works with mouse, touch, and keyboard (`←` `→` photos, `I` info, `G` gallery, `D` dates, `1` `2` `3` modes, `0` reset, `F` fullscreen). Respects the device's reduced-motion setting.

## NASA API notes

NASA moved APOD to a new endpoint in September 2026:

```
https://science.nasa.gov/wp-json/wp/v2/apod-basic?date_from=261025&date_to=261102&per_page=25
```

- Dates are `YYMMDD`. Results come back newest first, up to 25 per page (`X-WP-Total` / `X-WP-TotalPages` headers).
- No API key is needed, so none is stored in this repo.
- The old `api.nasa.gov/planetary/apod` address retires December 1, 2026 and was returning a placeholder ("NASA Science" with the NASA logo) for every date. That was why images never showed up at first.
- `url` is the article page, not an image. Pictures come from `hdurl`, which can be over 25 MB, so the app asks NASA's image server for a resized copy (`?w=`) and falls back to the original if that fails.
- Explanations and credits contain HTML. The app rebuilds them with only simple formatting and safe links, never inserting the raw HTML.

## Files

- `index.html`: page structure
- `style.css`: styles (NASA blue, red, black, Public Sans / Inter)
- `js/script.js`: all custom JavaScript
- `js/dateRange.js`: starter date limits (unchanged)

Independent student project. Not affiliated with or endorsed by NASA. Images belong to the credited creators.
