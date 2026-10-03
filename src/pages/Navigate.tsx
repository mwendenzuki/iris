import type { ComponentProps } from 'react'
import { RunScreen } from '../components/RunScreen'

/** Route "/navigate": camera view, obstacle alerts and walking directions. */
export default function Navigate(props: ComponentProps<typeof RunScreen>) {
  return <RunScreen {...props} />
}
