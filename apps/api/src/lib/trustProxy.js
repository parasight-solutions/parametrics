import net from "node:net";

// Express `trust proxy` value derived from TRUST_PROXY.
// Default is false: req.ip is the socket peer and X-Forwarded-For is ignored.
// `true` is refused because it trusts every hop, which makes X-Forwarded-For
// client-controlled again.
const NAMED_SUBNETS = new Set(["loopback", "linklocal", "uniquelocal"]);
const MAX_HOPS = 10;

function configError(message) {
  const err = new Error(message);
  err.code = "trust_proxy_config_invalid";
  return err;
}

function isAddressOrCidr(value) {
  const [addr, prefix, extra] = value.split("/");
  if (extra !== undefined) return false;
  const family = net.isIP(addr);
  if (!family) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

export function resolveTrustProxy(env = process.env) {
  const raw = String(env.TRUST_PROXY ?? "").trim().toLowerCase();
  if (!raw || raw === "false" || raw === "0") return false;

  if (raw === "true") {
    throw configError(
      "TRUST_PROXY=true trusts every hop and lets clients spoof X-Forwarded-For; set a hop count or proxy addresses"
    );
  }

  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    if (hops < 1 || hops > MAX_HOPS) {
      throw configError(`TRUST_PROXY hop count must be between 1 and ${MAX_HOPS}`);
    }
    return hops;
  }

  const parts = raw.split(",").map((item) => item.trim()).filter(Boolean);
  const valid = parts.length > 0 && parts.every((item) => NAMED_SUBNETS.has(item) || isAddressOrCidr(item));
  if (!valid) {
    throw configError(
      "TRUST_PROXY must be false, a hop count, or a comma list of loopback/linklocal/uniquelocal/IP/CIDR"
    );
  }
  return parts.join(",");
}

export function describeTrustProxy(value) {
  if (value === false) return "off";
  if (typeof value === "number") return `hops:${value}`;
  return `list:${String(value).split(",").length}`;
}
