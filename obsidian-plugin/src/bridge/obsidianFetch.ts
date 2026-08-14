import { requestUrl } from "obsidian";
import type { JsonPoster } from "./dshHttp";

/**
 * POST-json fetcher that uses Obsidian's `requestUrl`, which runs in the main
 * process and is NOT subject to the renderer's Content-Security-Policy / CORS.
 * This is what makes calls to the local dsh HTTP service work inside Obsidian
 * (a plain `fetch` in the renderer fails with "Failed to fetch").
 */
export const obsidianJsonPoster: JsonPoster = async (url, body) => {
  const res = await requestUrl({
    url,
    method: "POST",
    contentType: "application/json",
    body,
    throw: false,
  });
  return { status: res.status, text: res.text };
};
