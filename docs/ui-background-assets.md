# UI Background Assets

The Android UI uses one shared 4K wallpaper per color mode. Each source image is
composed for both landscape and centered portrait cropping, so separate phone
and tablet files are not required.

## Assets

The v2 pair is the recommended final candidate for the refreshed Android and
desktop-compatible shell. The files are deliberately wallpaper-like rather
than preview cards: there is no text, logo, watermark, person, or focal object
that would compete with study content.

- Light: `/assets/backgrounds/study-wallpaper-xuan-paper-light-v2.webp`
  - Warm rice-paper ivory with yellow undertones, coarse pulp variation,
    irregular long and short fibers, and visible handmade-paper relief.
  - 3840 x 2160, WebP, 585758 bytes.
- Dark: `/assets/backgrounds/study-wallpaper-starry-oil-dark-v2.webp`
  - Cobalt, ultramarine, indigo, and violet oil-paint night sky with thick
    impasto, palette-knife strokes, canvas grain, and a calmer low-detail
    center for readable overlays.
  - 3840 x 2160, WebP, 1586520 bytes.

Both images intentionally keep the center low-detail and contain no text,
logos, watermarks, people, or high-contrast focal objects.

## Recommended Integration

Use the image as an ambient page layer rather than as a content surface:

```css
.app-shell {
  background-image: var(--app-wallpaper);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}
```

Keep reading passages, options, vocabulary cards, dialogs, and AI messages on
high-opacity theme surfaces. A subtle theme-colored scrim may be placed between
the wallpaper and page content when a screen contains less surface coverage.

Suggested tokens:

```css
:root {
  --app-wallpaper: url("/assets/backgrounds/study-wallpaper-xuan-paper-light-v2.webp");
}

[data-theme="dark"] {
  --app-wallpaper: url("/assets/backgrounds/study-wallpaper-starry-oil-dark-v2.webp");
}
```

Use the same centered crop in compact portrait, phone landscape, and expanded
tablet layouts. Do not stretch the image or apply it separately to individual
cards. Keep a solid-color fallback in case the asset is unavailable. For dense
reading or dialogue views, an optional theme-colored scrim can reduce visible
star points without removing the oil-paint texture.

The asset layer is intentionally separate from content surfaces. Passages,
questions, options, vocabulary cards, answer sheets, dialogs, and AI messages
should use high-opacity surfaces (roughly 94–98% in light mode and 92–97% in
dark mode), so the tactile background remains an atmosphere instead of reducing
contrast. The public Android source now applies these assets to the shared app
shell in both portrait and landscape layouts. APK publication remains a
separate release action.

## Design References

- Material 3 Expressive Bottom Navigation: energetic navigation emphasis while
  keeping the content area quiet.
- Material 3 Medium Flexible Top App Bar: compact hierarchy that leaves more
  space for study content.
- Material 3 Bottom Sheet and Docked Toolbar: layered actions on opaque surfaces
  above the ambient wallpaper.
