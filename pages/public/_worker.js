// nho-nha.pages.dev, the app's address since 13/10/2026: a front door and
// nothing more. Every request goes to the nho-nha Worker as it came (this
// address, cookies, headers) through a service binding, and its answer
// comes back untouched. The app lives in the Worker (../../worker), so
// scripts/deploy.sh is all an update needs; this file only changes if the
// door itself does.
//
// Why a door at all: a Worker's own address carries its account's name, so
// the Worker's workers.dev address is off (../../wrangler.jsonc).
export default {
  fetch(request, env) {
    return env.APP.fetch(request);
  },
};
