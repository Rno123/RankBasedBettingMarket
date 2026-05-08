"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function AuthRedirectHandler({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    const returnTo = sessionStorage.getItem("authReturnTo");
    if (returnTo && pathname !== returnTo) {
      sessionStorage.removeItem("authReturnTo");
      window.location.href = returnTo;
    }
  }, [pathname]);

  return <>{children}</>;
}
