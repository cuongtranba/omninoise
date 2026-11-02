import React, { createContext, useContext, useMemo } from "react"

import { COPY, type Copy } from "../generated/content"
import { DEFAULT_LOCALE, type Locale } from "../generated/timeline"

interface Active {
  readonly locale: Locale
  readonly copy: Copy
}

const CopyContext = createContext<Active>({ locale: DEFAULT_LOCALE, copy: COPY[DEFAULT_LOCALE] })

/**
 * Language is ambient, not threaded.
 *
 * A scene should not take a `copy` prop it only forwards — every component
 * between the composition and a caption would have to carry it, and the day one
 * of them forgot, that caption would silently render in English inside another
 * language's cut. Reading it from context makes that impossible to get wrong.
 */
export const CopyProvider: React.FC<{ locale: Locale; children: React.ReactNode }> = ({
  locale,
  children,
}) => {
  const value = useMemo(() => ({ locale, copy: COPY[locale] }), [locale])
  return <CopyContext.Provider value={value}>{children}</CopyContext.Provider>
}

export const useCopy = (): Copy => useContext(CopyContext).copy

export const useLocale = (): Locale => useContext(CopyContext).locale
