const { handleRequest } = require("../server.cjs");

module.exports = (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const guide = url.searchParams.get("guide") || url.pathname.split("/api/guide/")[1];
  req.url = guide ? "/api/guide/" + encodeURIComponent(guide) + url.search : "/api";
  return handleRequest(req, res);
};
