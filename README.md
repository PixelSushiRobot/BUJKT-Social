# BUJKT Social

BUJKT Social is an unpublished Chrome extension that makes the Objkt social feed smoother: notifications, messages and price-sorted bookmarks in one place, without leaving the feed.

It's the follow-up to [BUJKT](https://github.com/PixelSushiRobot/BUJKT), which sorts your Objkt bookmarks by price. That feature now lives here too.

> [!WARNING]
> BUJKT Social is an **unofficial, personal-use tool**. It is **not affiliated with, authorized by, or endorsed by objkt AG** or the OBJKT Marketplace. The name "BUJKT" is a fan wordplay and is not associated with the official objkt brand.
>
> **Use at your own risk.** BUJKT Social runs in your own browser and changes how objkt's pages look and behave. Unlike BUJKT, it also:
>
> - loads objkt pages in hidden panels, and opens the Profile hub, its tabs, filters and "Load more" in them for you;
> - asks objkt's public data service (`data.objkt.com`) about offers, sales, listings and auctions, within its published rate limit;
> - asks TzKT (`api.tzkt.io`), a public Tezos explorer, for your wallet balance.
>
> It collects no data and sends nothing anywhere else.
>
> Please be aware that objkt's [Terms and Conditions](https://objkt.com/terms) restrict the use of browser extensions, scripts and other automated means that modify the rendering of Marketplace pages or extract data without their authorization. This tool may not be permitted under those terms. You are solely responsible for deciding whether and how to use it, and for complying with objkt's Terms. The author provides this code as-is, for personal and educational purposes, with no warranty of any kind.
>
> If you represent objkt and would like changes to this repository, please open an issue or contact the author.

## Features

- **Social nav** at the top of the left rail: Home, Search, Notifications, Messages and Bookmarks, all opening in the feed column, with unread badges.
- **Notifications, regrouped**: each artist's new works become one row of large thumbnails, likes and follows are merged, and open offers stand out.
- **Bookmarks, sorted by price**: every bookmark loads by itself, then sorts low → high or high → low, with artworks that have no price kept at the end.
- **Messages** with the chat list and the open chat side by side.
- **Right rail**:
  - your stats;
  - **For you**: open offers, auctions you're winning, things ending soon, new auctions and objkt's picks;
  - a slideshow of new drops, your collection or top sales.
- **⌘K / Ctrl+K** opens Search from any objkt page.

## Installation

This extension is not published on the Chrome Web Store.

1. Download `bujkt-social.zip` from the [latest release](https://github.com/PixelSushiRobot/BUJKT-Social/releases/latest) and unzip it.
1. Open Chrome and go to `chrome://extensions`.
1. Enable **Developer mode** in the top-right corner.
1. Click **Load unpacked** and select the unzipped folder.

To update, replace the folder with the new release, then click the reload button on BUJKT Social in `chrome://extensions`.

> [!NOTE]
> On the Bookmarks tab, the extension clicks **Load more** for you until every bookmark is loaded, so large lists can take a moment.

## Privacy

Everything stays in your browser. BUJKT Social saves a few settings in objkt's site storage: which offers you've seen, your slideshow tab, your bookmark sort, and your wallet address if you typed it in.

## Releasing

Push a version tag that matches `version` in `manifest.json`, for example `v1.0.0`. A GitHub Action builds `bujkt-social.zip` and attaches it to a new release. The download page in `docs/` always links to the latest release.

## License

[MIT](LICENSE)

---

_Unofficial tool. Not affiliated with objkt AG. Use at your own risk and at your own discretion under objkt's Terms._
