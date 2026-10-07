import { useAuth } from '../auth'

/** Shows children only when the signed-in user's role has `perm` (replaces the old admin-key screen). */
export default function RequireAdmin({ perm = 'users.manage', children }) {
  const { can } = useAuth()
  return can(perm) ? children : <div className="page"><div className="card empty"><h2>No access</h2></div></div>
}
