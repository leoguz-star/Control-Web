import type { CSSProperties } from 'react'

interface Props {
  name: string
  size?: number
  className?: string
  style?: CSSProperties
}

export default function Icon({ name, size = 16, className, style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      style={style}
      aria-hidden
    >
      <use href={`/icons.svg#${name}`} />
    </svg>
  )
}
