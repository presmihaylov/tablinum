import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 14, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ChevronRight = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Svg>
);

export const ChevronDown = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3.5 6 8 10.5 12.5 6" />
  </Svg>
);

export const Plus = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);

export const Search = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="7.2" cy="7.2" r="4.2" />
    <path d="m10.4 10.4 3 3" />
  </Svg>
);

export const Dots = (props: IconProps) => (
  <Svg {...props} strokeWidth={2}>
    <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" />
  </Svg>
);

export const Sync = (props: IconProps) => (
  <Svg {...props}>
    <path d="M13 7A5 5 0 0 0 3.6 5.2M3 9a5 5 0 0 0 9.4 1.8" />
    <path d="M13 2.5V7h-4.2M3 13.5V9h4.2" />
  </Svg>
);

export const Sun = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.9 3.1l-1 1M4.1 11.9l-1 1M12.9 12.9l-1-1M4.1 4.1l-1-1" />
  </Svg>
);

export const Moon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5 5.6 5.6 0 1 0 13.5 9.6Z" />
  </Svg>
);

export const PanelLeft = (props: IconProps) => (
  <Svg {...props}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6.2 3v10" />
  </Svg>
);

export const PanelRight = (props: IconProps) => (
  <Svg {...props}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M9.8 3v10" />
  </Svg>
);

export const DocIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5Z" />
    <path d="M9 1.5V5.5H13" />
  </Svg>
);

export const Trash = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.6 9a1 1 0 0 0 1 1h4.8a1 1 0 0 0 1-1L12 4" />
  </Svg>
);

export const Copy = (props: IconProps) => (
  <Svg {...props}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5h1" />
  </Svg>
);

export const MoveTo = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2 8h7.5M7 5.5 9.5 8 7 10.5" />
    <path d="M9.5 3h3A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-3" />
  </Svg>
);

export const Link = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6.5 9.5a2.5 2.5 0 0 0 3.6 0l2-2a2.5 2.5 0 0 0-3.6-3.6l-.8.8" />
    <path d="M9.5 6.5a2.5 2.5 0 0 0-3.6 0l-2 2a2.5 2.5 0 0 0 3.6 3.6l.8-.8" />
  </Svg>
);

export const Pencil = (props: IconProps) => (
  <Svg {...props}>
    <path d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5 13.1l-3 .7.7-3Z" />
  </Svg>
);

export const History = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2.6 8a5.4 5.4 0 1 0 1.7-3.9" />
    <path d="M2.4 2.6V5.6h3M8 5v3.2l2.2 1.3" />
  </Svg>
);

export const Close = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const Branch = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="4.5" cy="3.5" r="1.6" />
    <circle cx="4.5" cy="12.5" r="1.6" />
    <circle cx="11.5" cy="6" r="1.6" />
    <path d="M4.5 5.1v5.8M11.5 7.6c0 2-1.6 2.6-3.4 2.9-1.4.2-2.6.5-3.6 1" />
  </Svg>
);

export const UserIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="8" cy="5.5" r="2.6" />
    <path d="M2.8 13.4a5.2 5.2 0 0 1 10.4 0" />
  </Svg>
);

export const People = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="6" cy="6" r="2.3" />
    <path d="M1.8 13a4.2 4.2 0 0 1 8.4 0" />
    <path d="M10.6 4.1a2.3 2.3 0 0 1 0 4.4M11.6 9.6A4.2 4.2 0 0 1 14.2 13" />
  </Svg>
);

export const Bot = (props: IconProps) => (
  <Svg {...props}>
    <rect x="2.5" y="5.5" width="11" height="8" rx="2" />
    <path d="M8 2v3.5M5.5 9.5h.01M10.5 9.5h.01M1 8.5v2M15 8.5v2" />
  </Svg>
);

export const Smiley = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M5.9 6.4v.6M10.1 6.4v.6M5.7 9.6a2.9 2.9 0 0 0 4.6 0" />
  </Svg>
);

export const SignOut = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6.5 2.8H3.4v10.4h3.1" />
    <path d="M9 5.5 11.8 8 9 10.5M11.8 8H6.2" />
  </Svg>
);

export const Settings = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" />
  </Svg>
);

export const Upload = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 10.5V2.6M5.2 5.4 8 2.6l2.8 2.8" />
    <path d="M2.8 10.6v1.8a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-1.8" />
  </Svg>
);

export const Download = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 2.6v7.9M5.2 7.7 8 10.5l2.8-2.8" />
    <path d="M2.8 10.6v1.8a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-1.8" />
  </Svg>
);
