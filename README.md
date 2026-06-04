# Booth Contact Scanner

A self-contained **PWA** (installable web app) for scanning conference badges from
an iPhone. It decodes the badge **barcode** and runs **OCR** on the printed text to
capture **Name, Job Title, Company, and Barcode #**, then lets you export everything
to **CSV/Excel**.

Everything runs in the browser — no backend, no app store, no organizer API needed.

## How it works

1. **Start camera** → the rear camera opens and continuously looks for the barcode.
2. When a barcode is found it locks in (you'll feel a buzz).
3. **Capture badge** → grabs a still frame and runs OCR (Tesseract.js) on the text.
4. **Review** → the app pre-fills its best guess for name/title/company. Fix anything
   that's off — tap a detected text line (chip), then tap the field to assign it.
5. **Save & scan next** → contact **and the badge photo** are stored on the phone.
6. **Export** → downloads a **ZIP** containing `contacts.csv` (opens in Excel) plus a
   `photos/` folder with every badge image, named to match the CSV's *Photo File*
   column. If there are no photos (or you're fully offline), it falls back to a plain CSV.

In the **List** tab, tap a contact's thumbnail to view the full badge photo —
on iPhone you can then **long-press → Save to Photos** for an individual image.

## ⚠️ Hosting requirement (camera needs HTTPS)

iPhone Safari only grants camera access on a **secure origin** (`https://` or
`localhost`). Pick one:

### Option A — Quick test on your computer (localhost)
```powershell
# from the ContactScanner folder
npx serve .
# then open the shown http://localhost:3000 on the SAME computer
```
(Camera works on `localhost`, but you can't reach `localhost` from the phone — use B or C to test on the iPhone itself.)

### Option B — Free HTTPS hosting (recommended for the event)
- **Netlify Drop**: drag this folder onto <https://app.netlify.com/drop> → instant HTTPS URL.
- **GitHub Pages**: push the folder to a repo → Settings → Pages → deploy.
- Either gives you a link to open on the iPhone.

### Option C — Your own IIS / web server
Drop these static files in any HTTPS site directory (no app pool / .NET needed).

## Install on the iPhone (recommended)

1. Open the HTTPS URL in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Launch it from the home-screen icon — it runs full-screen like a native app.
4. First launch will ask for **camera permission** — allow it.

## Notes & tuning

- **OCR accuracy:** names in stylised fonts can misread — that's why every scan goes
  through the editable Review screen before saving. The chip-tap reassignment makes
  corrections fast.
- **Offline:** the app shell is cached by the service worker. The OCR engine downloads
  its language model on first use, so do one scan while online to warm the cache; after
  that it works without signal.
- **Barcode types:** ZXing auto-detects Code 128 (your sample), Code 39, QR, EAN, etc.
- **Data location:** contacts and photos live in the browser's **IndexedDB** on that
  phone (chosen over `localStorage` because it holds many high-res images without hitting
  the ~5 MB cap). Export regularly so nothing is lost if the app data is cleared.
- **Heuristic guess:** by default line 1 = name, line 2 = title, line 3 = company after
  filtering out header noise (`GOVERNMENT / SERVICE / DELIVERY / Event Partner`). Adjust
  the `NOISE` regex in `app.js` if your badges have different boilerplate.

## Files
| File | Purpose |
|------|---------|
| `index.html` | UI / layout |
| `styles.css` | Styling |
| `app.js` | Camera, barcode decode, OCR, save, CSV export |
| `manifest.webmanifest` | PWA install metadata |
| `sw.js` | Service worker (offline shell) |
| `icons/` | Home-screen icons |
