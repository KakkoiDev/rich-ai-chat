/**
 * This browser profile's random id: it scopes plans and jobs (no accounts). Kept in localStorage, which is per origin,
 * and sent as the x-rich-chat-profile header, never as a cookie: cookies are shared by every port on a host, so an
 * installed app on the export origin could read one.
 */
const profileKey = "rich-ai-chat:profile";
let memoryProfile = "";

export function readProfile() {
  try {
    let id = localStorage.getItem(profileKey) ?? "";
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(profileKey, id);
    }
    return id;
  } catch {
    memoryProfile ||= crypto.randomUUID();
    return memoryProfile;
  }
}

export const profileHeader = "x-rich-chat-profile";
