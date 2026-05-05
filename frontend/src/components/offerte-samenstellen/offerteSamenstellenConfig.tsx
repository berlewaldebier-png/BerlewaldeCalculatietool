"use client";

import React from "react";

import type { OptionType } from "@/components/offerte-samenstellen/types";

export const tones: Record<OptionType, string> = {
  Intro: "cpq-tone-intro",
  Staffel: "cpq-tone-staffel",
  Mix: "cpq-tone-mix",
  Korting: "cpq-tone-korting",
  Groothandel: "cpq-tone-korting",
  Transport: "cpq-tone-transport",
  Retour: "cpq-tone-retour",
  Proeverij: "cpq-tone-proeverij",
  Tapverhuur: "cpq-tone-tap",
};

export const icons: Record<OptionType, React.ReactNode> = {
  Intro: <IconClock />,
  Staffel: <IconChart />,
  Mix: <IconShuffle />,
  Korting: <IconTag />,
  Groothandel: <IconStorefront />,
  Transport: <IconTruck />,
  Retour: <IconReturn />,
  Proeverij: <IconBeer />,
  Tapverhuur: <IconTent />,
};

function BaseIcon({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="cpq-icon"
      role="img"
      aria-label={title}
      focusable="false"
    >
      {children}
    </svg>
  );
}

function IconClock() {
  return (
    <BaseIcon title="Introductie">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5v5.0l3.2 2.0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </BaseIcon>
  );
}

function IconChart() {
  return (
    <BaseIcon title="Staffel">
      <path d="M6 18V10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 18V6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 18v-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 18.5h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </BaseIcon>
  );
}

function IconShuffle() {
  return (
    <BaseIcon title="Mix deal">
      <path d="M6 7h4l2.2 3.2L14.5 7H18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M18 7l-2 2m2-2l-2-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 17h4l2.2-3.2 2.3 3.2H18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M18 17l-2 2m2-2l-2-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </BaseIcon>
  );
}

function IconTag() {
  return (
    <BaseIcon title="Korting">
      <path d="M4.8 12.0l7.2 7.2c.4.4 1 .4 1.4 0l5.8-5.8c.4-.4.4-1 0-1.4L12 4.8H7.3c-.5 0-1 .2-1.3.6L4.3 7.1c-.3.3-.5.8-.5 1.3V12z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="8.3" cy="8.3" r="1.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </BaseIcon>
  );
}

function IconStorefront() {
  return (
    <BaseIcon title="Groothandel">
      <path
        d="M5.2 10.2h13.6v8.3H5.2zm1-4.5h11.6l1 3.3H5.2zm3.1 8.1v4.7m5.4-4.7v4.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  );
}

export function IconTrash() {
  return (
    <BaseIcon title="Verwijderen">
      <path
        d="M8 7h8m-7 0V5.8c0-.44.36-.8.8-.8h4.4c.44 0 .8.36.8.8V7m-8.4 0-.6 10.2c-.03.46.34.84.8.84h8.8c.46 0 .83-.38.8-.84L16.4 7M10 10.2v4.8M14 10.2v4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  );
}

function IconTruck() {
  return (
    <BaseIcon title="Transport">
      <path d="M3.8 15.5V7.5h9.5v8.0H3.8z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13.3 10.0h3.7l2.2 2.6v2.9h-5.9V10z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="7.1" cy="16.8" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="16.8" cy="16.8" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </BaseIcon>
  );
}

function IconReturn() {
  return (
    <BaseIcon title="Retour">
      <path d="M9.5 8.2L6 11.8l3.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 11.8h8.4c2.7 0 4.6 1.9 4.6 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </BaseIcon>
  );
}

function IconBeer() {
  return (
    <BaseIcon title="Proeverij">
      <path d="M7.2 7.5h6.6v8.8c0 1.2-1 2.2-2.2 2.2H9.4c-1.2 0-2.2-1-2.2-2.2V7.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13.8 9.2h1.6c1.3 0 2.4 1.1 2.4 2.4s-1.1 2.4-2.4 2.4h-1.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7.2 7.5c0-1.2 1-2.2 2.2-2.2h2.2c1.2 0 2.2 1 2.2 2.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </BaseIcon>
  );
}

function IconTent() {
  return (
    <BaseIcon title="Tapverhuur">
      <path d="M4.5 18.5L12 5.8l7.5 12.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9.2 18.5V14.2c0-.6.5-1.1 1.1-1.1h3.4c.6 0 1.1.5 1.1 1.1v4.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </BaseIcon>
  );
}
