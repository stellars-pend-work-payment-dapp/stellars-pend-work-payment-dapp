import React from "react";
import Link from "next/link";
import Image from "next/image";

export function SidebarLogo() {
  return (
    <Link href="/" className="flex items-center  pt-12 pb-6">
      <Image
        src="/stellar-payment-gateway.svg"
        alt="Stellar Logo"
        width={90}
        height={90}
        className="w-auto"
      />
    </Link>
  );
}
