import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { publicConfig, setNumberFormat } from './api'
import { useApp } from './theme'

/* Branding and display defaults from Administration › System Configuration.
   Loaded before sign-in (the sign-in page shows the name and logo). */
export const BRAND_DEFAULTS = {
  company_name: 'Al-Dowayan', short_name: 'AD', tagline: 'Financial Reporting', logo: '',
  login_message: 'Financial reporting from Dynamics 365 - dashboards, statements and data pipeline in one place.',
  default_theme: 'teal', default_language: 'en', currency: 'SAR', decimals: 0, negatives: 'minus',
}
const Ctx = createContext({ config: BRAND_DEFAULTS, reload: () => {} })
export const useConfig = () => useContext(Ctx)

export function ConfigProvider({ children }) {
  const { applyDefaults } = useApp()
  const [config, setConfig] = useState(BRAND_DEFAULTS)
  const [version, setVersion] = useState(0)          // re-render pages after a number-format change

  const apply = useCallback((c, redraw = false) => {
    const full = { ...BRAND_DEFAULTS, ...c }
    setNumberFormat(full)
    setConfig(full)
    if (redraw) setVersion((v) => v + 1)
    applyDefaults(full)
  }, [applyDefaults])

  const reload = useCallback(() => publicConfig().then(apply).catch(() => {}), [apply])
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={{ config, reload, apply, version }}>{children}</Ctx.Provider>
}

/** Logo square: the uploaded image, or the logo letters. */
export function LogoMark({ big }) {
  const { config } = useConfig()
  return config.logo
    ? <img className={`logo-img ${big ? 'big' : ''}`} src={config.logo} alt="" />
    : <div className={`logo-mark ${big ? 'big' : ''}`} data-no-tr>{config.short_name}</div>
}
