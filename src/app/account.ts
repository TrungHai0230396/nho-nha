import { store, toast } from "./state";

/**
 * A guest signing in with Google: what waits on this phone goes up first,
 * since the account is where it will be from now on. Google's return lands
 * on the app, which then takes the account's notes, the guest's included
 * (the server moved them: worker/guest.ts).
 */
export async function upgradeToGoogle(): Promise<void> {
  await store.sync();
  if (store.getSnapshot().pending > 0) {
    toast("Còn ghi chú chưa gửi lên được. Có mạng rồi bấm lại.");
    return;
  }
  location.assign("/dang-nhap");
}
