import { useState, useEffect } from "react";

export type NetworkQuality = "unknown" | "poor" | "moderate" | "good";

export interface NetworkStatus {
  supported: boolean;
  effectiveType?: string; // 'slow-2g' | '2g' | '3g' | '4g'
  downlink?: number; // estimated Mbps
  saveData?: boolean;
  quality: NetworkQuality;
}

// Network Information API - not in the standard DOM lib types yet.
interface NetworkInformation extends EventTarget {
  effectiveType?: string;
  downlink?: number;
  saveData?: boolean;
}

// Chrome/Android only, no Safari/Firefox support, so `supported` must
// always be checked before relying on the other fields.
function readConnection(): NetworkInformation | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & {
    connection?: NetworkInformation;
    mozConnection?: NetworkInformation;
    webkitConnection?: NetworkInformation;
  };
  return nav.connection || nav.mozConnection || nav.webkitConnection;
}

function classify(effectiveType?: string, saveData?: boolean): NetworkQuality {
  if (saveData) return "poor";
  switch (effectiveType) {
    case "slow-2g":
    case "2g":
      return "poor";
    case "3g":
      return "moderate";
    case "4g":
      return "good";
    default:
      return "unknown";
  }
}

function buildStatus(connection: NetworkInformation | undefined): NetworkStatus {
  if (!connection) {
    return { supported: false, quality: "unknown" };
  }
  return {
    supported: true,
    effectiveType: connection.effectiveType,
    downlink: connection.downlink,
    saveData: connection.saveData,
    quality: classify(connection.effectiveType, connection.saveData),
  };
}

export const useNetworkStatus = (): NetworkStatus => {
  const [status, setStatus] = useState<NetworkStatus>(() =>
    buildStatus(readConnection())
  );

  useEffect(() => {
    const connection = readConnection();
    if (!connection) return;

    const handleChange = () => setStatus(buildStatus(connection));
    connection.addEventListener?.("change", handleChange);
    return () => connection.removeEventListener?.("change", handleChange);
  }, []);

  return status;
};

export default useNetworkStatus;
