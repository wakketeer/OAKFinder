# OAK Room Capture

Phone web app for cataloging rugs in Feizy's OAK room. Each rug gets one or more rug photos, a tag photo, and an optional barcode, note and flag. Everything is saved on the device as you go. Export sends a stack's photos and a CSV to OneDrive through the phone's share sheet.

## Put it on GitHub Pages

1. Create a GitHub repository and upload everything in this folder to it, keeping the folder structure.
2. In the repository, go to **Settings → Pages**, set **Source** to "Deploy from a branch", pick `main` and `/ (root)`, and save.
3. The app's address appears on that page after a minute or two (`https://<account>.github.io/<repo>/`).

## Install on the phone

Open the address once while online, then add it to the home screen:

- **iPhone:** Safari → Share → Add to Home Screen.
- **Android:** Chrome → ⋮ menu → Add to Home screen / Install app.

After that it opens and works with no connection.

## Use

1. **Start stack:** give it a label (for example, "OAK Stack 4").
2. For each rug: **+ Rug photo** (repeat as needed), **+ Tag photo**, type a barcode or note if wanted, tap **Flag** if wanted, then **Save & next**.
3. **List** shows every rug in the stack. Tap one to edit, add or delete photos, or delete the rug.
4. **Export stack** (on the List screen): tap **Share to OneDrive…**, pick OneDrive, choose a folder. Only saved rugs are exported. If the browser can't share files, use **Download files** instead.

Files are named `<stack> - Rug 001 - 1.jpg`, `<stack> - Rug 001 - tag.jpg`, plus `<stack>.csv` listing each rug's barcode, note, flag and photo file names.

## Keep in mind

- Captures live only in this browser on this device until exported. Export each stack when it's done. Clearing the browser's site data, or not opening the app for a long stretch, can erase what hasn't been exported.
- Photos are resized on the phone to 2048 px on the long edge (JPEG, 80% quality).

## Updating the app

After changing any file, edit the `VERSION` line at the top of `sw.js` (for example, `oak-capture-v2`) before uploading. Phones pick up the new version the next time the app is opened online.
