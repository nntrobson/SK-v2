// Redirect to new signin page
import { redirect } from 'next/navigation'

export default function LoginPage() {
  redirect('/signin')
}
