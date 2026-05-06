import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Home, Users, Calendar, Clock, Link2, MessageCircle,
  Settings as SettingsIcon,
  User as UserIcon, LogOut,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useAuth } from '../context/AuthContext'
import { useNotes } from '../context/NotesContext'
import { Tooltip } from './Tooltip'

/* Single icon size for the whole sidebar so icons feel like a coherent set
   (this is the main visual difference vs. the previous emoji approach,
   which rendered with whatever size each OS' emoji font happened to use). */
const ICON_SIZE = 20
const ICON_STROKE = 1.75

const NAV = [
  { to: '/',             Icon: Home,           label: 'Dashboard' },
  { to: '/family',       Icon: Users,          label: 'Family' },
  { to: '/schedule',     Icon: Calendar,       label: 'Schedule' },
  { to: '/availability', Icon: Clock,          label: 'Availability' },
  { to: '/overlap',      Icon: Link2,          label: 'Overlap' },
  { to: '/notes',        Icon: MessageCircle,  label: 'Notes', notesBadge: true },
]

export default function Sidebar() {
  const { pathname } = useLocation()
  const { user, logout } = useAuth()
  const { unreadCount } = useNotes()
  const navigate = useNavigate()
  const initial = user?.name?.charAt(0).toUpperCase() || 'U'

  function handleLogout() {
    logout()
    navigate('/auth')
  }

  return (
    <div className="sidebar">
      <Tooltip label="TimeBridge home">
        <Link to="/" className="logo">TB</Link>
      </Tooltip>

      {NAV.map(({ to, Icon, label, notesBadge }) => {
        // Compose the tooltip — include unread count for the Notes entry.
        const tipLabel = notesBadge && unreadCount > 0
          ? `${label} · ${unreadCount} new`
          : label
        return (
          <Tooltip key={to} label={tipLabel}>
            <Link
              to={to}
              className={`nav-btn ${pathname === to ? 'active' : ''}`}
              aria-label={tipLabel}
            >
              <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
              {notesBadge && unreadCount > 0 && (
                <span
                  className="nav-badge"
                  aria-label={`${unreadCount} unread`}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          </Tooltip>
        )
      })}

      <div className="nav-spacer" />

      <Tooltip label="Settings">
        <Link
          to="/settings"
          className={`nav-btn ${pathname === '/settings' ? 'active' : ''}`}
          aria-label="Settings"
        >
          <SettingsIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </Link>
      </Tooltip>

      {/* Avatar opens a Radix dropdown — Profile / Settings / Sign out.
          The trigger is the same gradient avatar as before. */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="avatar-btn" aria-label="Account menu">{initial}</button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="right"
            sideOffset={10}
            align="end"
            className="dm-content"
          >
            <div className="dm-label">
              {user?.name || 'Account'}
            </div>
            <DropdownMenu.Item className="dm-item" onSelect={() => navigate('/profile')}>
              <UserIcon size={14} strokeWidth={2} aria-hidden="true" />
              Profile
            </DropdownMenu.Item>
            <DropdownMenu.Item className="dm-item" onSelect={() => navigate('/settings')}>
              <SettingsIcon size={14} strokeWidth={2} aria-hidden="true" />
              Settings
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="dm-sep" />
            <DropdownMenu.Item className="dm-item dm-danger" onSelect={handleLogout}>
              <LogOut size={14} strokeWidth={2} aria-hidden="true" />
              Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
