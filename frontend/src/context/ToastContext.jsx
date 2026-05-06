import { createContext, useContext, useState, useCallback } from 'react'

const Ctx = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const toast = useCallback((title, body = '', type = '') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, title, body, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="toast-area">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type ? `toast-${t.type}` : ''}`}>
            <div className="toast-title">{t.title}</div>
            {t.body && <div className="toast-body">{t.body}</div>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() { return useContext(Ctx) }
