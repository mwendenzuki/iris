import type { ComponentProps } from 'react'
import { SetupScreen } from '../components/SetupScreen'

/** Route "/": language, height and destination (typed or by voice). */
export default function Onboarding(props: ComponentProps<typeof SetupScreen>) {
  return <SetupScreen {...props} />
}
