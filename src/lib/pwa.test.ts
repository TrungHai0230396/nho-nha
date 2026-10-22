import { describe, expect, it } from "vitest";
import { PLATFORMS } from "../shared/protocol";
import { escapeUrl, inAppName, installWay, macSafari, onComputer, platformOf, shareWay } from "./pwa";

// User agents as each browser writes them; Safari's Version/ follows iOS.
const SAFARI_26 = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const SAFARI_18 = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1";
const FIREFOX = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15";
const EDGE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/140.0.3485.94 Mobile/15E148 Safari/605.1.15";
const IPAD_26 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

describe("where installing starts on iPhone", () => {
  it("Safari 26: Share inside ⋯, the action behind Xem thêm", () => {
    expect(shareWay(SAFARI_26, false)).toEqual({ button: "more", sheet: "more" });
  });

  it("Safari before 26: Share on the bar, the action down the list", () => {
    expect(shareWay(SAFARI_18, false)).toEqual({ button: "bar", sheet: "scroll" });
  });

  it("Chrome: Share at the top, whichever iOS it runs on", () => {
    expect(shareWay(CHROME, false)).toEqual({ button: "top", sheet: "either" });
  });

  it("another browser: its own menu, even one that also says Version/", () => {
    expect(shareWay(FIREFOX, false)).toEqual({ button: "menu", sheet: "either" });
    expect(shareWay(EDGE, false)).toEqual({ button: "menu", sheet: "either" });
  });

  it("iPad: Share at the top", () => {
    expect(shareWay(IPAD_26, true)).toEqual({ button: "top", sheet: "more" });
  });

  it("Safari that does not say its version: the newest way", () => {
    expect(shareWay("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", false)).toEqual({ button: "more", sheet: "either" });
  });
});

describe("out of Zalo, into the phone's own browser", () => {
  const ZALO_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/507 ZaloTheme/light ZaloLanguage/vi";
  const ZALO_ANDROID = "Mozilla/5.0 (Linux; Android 12; V2134) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36 Zalo/23.09.01 ZaloTheme/light";
  const HREF = "https://nho-nha.pages.dev/";

  it("iPhone: Safari's own scheme, the address otherwise untouched", () => {
    expect(escapeUrl(HREF, ZALO_IOS)).toBe("x-safari-https://nho-nha.pages.dev/");
    expect(escapeUrl("https://a.dev/cai/x/?n=1", ZALO_IOS)).toBe("x-safari-https://a.dev/cai/x/?n=1");
  });

  it("Android: an intent for Chrome, with the page to fall back to", () => {
    expect(escapeUrl(HREF, ZALO_ANDROID)).toBe(
      "intent://nho-nha.pages.dev/#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fnho-nha.pages.dev%2F;end",
    );
    expect(escapeUrl("https://a.dev/p?n=1", ZALO_ANDROID)).toMatch(/^intent:\/\/a\.dev\/p\?n=1#Intent;scheme=https;/);
  });

  it("takes a group's invite along, so Safari or Chrome opens it rather than the bare app", () => {
    const invite = "https://nho-nha.pages.dev/?moi=g_AbCdEfGhIjKlMnOpQrStUv.0123456789abcdef0123456789abcdef";
    expect(escapeUrl(invite, ZALO_IOS)).toBe(`x-safari-${invite}`);
    expect(escapeUrl(invite, ZALO_ANDROID)).toMatch(/^intent:\/\/nho-nha\.pages\.dev\/\?moi=g_AbCdEfGhIjKlMnOpQrStUv\.0123456789abcdef0123456789abcdef#Intent;scheme=https;/);
  });

  it("nowhere to go: a computer, or a page not on https", () => {
    expect(escapeUrl(HREF, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15")).toBeNull();
    expect(escapeUrl("http://127.0.0.1:8787/", ZALO_IOS)).toBeNull();
  });
});

describe("which app's browser the page is in", () => {
  // Real user agents, as each app writes them.
  const UA = {
    facebookIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/FBIOS;FBDV/iPhone14,3;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBID/phone;FBLC/vi_VN]",
    facebookAndroid: "Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/446.0.0.27.352;]",
    messengerIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/MessengerForiOS;FBAV/458.0.0.38.108;FBBV/586212345;FBDV/iPhone14,3]",
    messengerAndroid: "Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/440.0.0.31.105;]",
    instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.0.32.112 (iPhone14,3; iOS 17_5; vi_VN; vi; scale=3.00; 1170x2532; 548375166)",
    tiktok: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_34.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/vi Region/VN",
    zalo: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/507 ZaloTheme/light ZaloLanguage/vi",
    safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    chromeAndroid: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
  };

  it("names Facebook, on both phones", () => {
    expect(inAppName(UA.facebookIos)).toBe("Facebook");
    expect(inAppName(UA.facebookAndroid)).toBe("Facebook");
  });

  it("names Messenger, though it carries Facebook's tokens", () => {
    expect(inAppName(UA.messengerIos)).toBe("Messenger");
    expect(inAppName(UA.messengerAndroid)).toBe("Messenger");
  });

  it("names the others", () => {
    expect(inAppName(UA.instagram)).toBe("Instagram");
    expect(inAppName(UA.tiktok)).toBe("TikTok");
    expect(inAppName(UA.zalo)).toBe("Zalo");
  });

  it("leaves a real browser alone", () => {
    expect(inAppName(UA.safari)).toBeNull();
    expect(inAppName(UA.chromeAndroid)).toBeNull();
  });

  it("the way out works the same from Facebook as from Zalo", () => {
    expect(escapeUrl("https://a.dev/", UA.facebookIos)).toBe("x-safari-https://a.dev/");
    expect(escapeUrl("https://a.dev/", UA.facebookAndroid)).toMatch(/^intent:\/\/a\.dev\/#Intent;scheme=https;package=com\.android\.chrome;/);
  });
});

describe("how a device puts the app on itself", () => {
  const MAC_SAFARI_17 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
  const MAC_SAFARI_16 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15";
  const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  const WIN_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
  const WIN_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0";
  const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

  it("one tap wherever the browser offers it: Chrome or Edge, on a computer or Android", () => {
    for (const ua of [MAC_CHROME, WIN_EDGE, ANDROID_CHROME]) expect(installWay("ready", ua, false, false)).toBe("prompt");
  });

  it("the menu's steps where it never offers: iPhone, iPad, a Mac's Safari 17 on", () => {
    expect(installWay("manual", SAFARI_26, false, false)).toBe("steps");
    expect(installWay("manual", IPAD_26, true, false)).toBe("steps");
    expect(installWay("manual", MAC_SAFARI_17, false, false)).toBe("steps");
  });

  it("nothing where it cannot, or need not", () => {
    expect(installWay("manual", WIN_FIREFOX, false, false)).toBeNull();
    expect(installWay("manual", MAC_SAFARI_16, false, false)).toBeNull();
    // Chrome not offering: installed already, or not yet sure the page is an app.
    expect(installWay("manual", MAC_CHROME, false, false)).toBeNull();
    expect(installWay("installed", MAC_CHROME, false, false)).toBeNull();
    expect(installWay("app", SAFARI_26, false, false)).toBeNull();
    // Inside Zalo's browser: nothing installs there.
    expect(installWay("ready", ANDROID_CHROME, false, true)).toBeNull();
  });

  it("tells a Mac from an iPad that says it is one, and Safari from Chrome on a Mac", () => {
    expect(macSafari(IPAD_26, true)).toBe(false);
    expect(macSafari(IPAD_26, false)).toBe(true);
    expect(macSafari(MAC_CHROME, false)).toBe(false);
    expect(onComputer(MAC_CHROME, false)).toBe(true);
    expect(onComputer(WIN_FIREFOX, false)).toBe(true);
    expect(onComputer(ANDROID_CHROME, false)).toBe(false);
    expect(onComputer(IPAD_26, true)).toBe(false);
  });
});

describe("what kind of device, for counting installs", () => {
  const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
  const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  const ZALO_ANDROID = "Mozilla/5.0 (Linux; Android 12; V2134) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36 Zalo/23.09.01 ZaloTheme/light";
  const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  const WIN_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
  const WIN_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0";
  const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  const CHROMEOS = "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  const IPOD = "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1";

  it("an iPhone, in any of its browsers, and an iPod with it", () => {
    for (const ua of [SAFARI_26, SAFARI_18, CHROME, FIREFOX, EDGE, IPOD]) expect(platformOf(ua, false)).toBe("iphone");
  });

  it("an iPad that says it is a Mac, and the Mac that says the same words", () => {
    expect(platformOf(IPAD_26, true)).toBe("ipad");
    expect(platformOf(IPAD_26, false)).toBe("mac");
    expect(platformOf(MAC_CHROME, false)).toBe("mac");
  });

  it("Android, phone or tablet, Zalo's browser too", () => {
    for (const ua of [ANDROID_PHONE, ANDROID_TABLET, ZALO_ANDROID]) expect(platformOf(ua, false)).toBe("android");
  });

  it("Windows, whichever browser", () => {
    expect(platformOf(WIN_EDGE, false)).toBe("windows");
    expect(platformOf(WIN_FIREFOX, false)).toBe("windows");
  });

  it("anything else is other, never a word the server would refuse", () => {
    for (const ua of [LINUX, CHROMEOS, "", "curl/8.7.1"]) expect(platformOf(ua, false)).toBe("other");
    for (const ua of [SAFARI_26, IPAD_26, ANDROID_PHONE, MAC_CHROME, WIN_EDGE, LINUX]) {
      expect(PLATFORMS).toContain(platformOf(ua, false));
      expect(PLATFORMS).toContain(platformOf(ua, true));
    }
  });
});
