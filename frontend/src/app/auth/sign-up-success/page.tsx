import { Target, Mail } from 'lucide-react'
import Link from 'next/link'

export default function SignUpSuccessPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="relative">
            <div className="absolute inset-0 bg-orange-500/20 rounded-full blur-xl" />
            <div className="relative bg-gradient-to-br from-orange-500 to-orange-600 p-3 rounded-2xl shadow-lg shadow-orange-500/25">
              <Target className="w-8 h-8 text-white" />
            </div>
          </div>
          <span className="text-2xl font-bold text-white">ShotTracker</span>
        </div>

        {/* Card */}
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 shadow-xl text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-green-500/10 p-4 rounded-full">
              <Mail className="w-12 h-12 text-green-400" />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-white mb-3">Check your email</h1>
          <p className="text-slate-400 mb-6">
            We&apos;ve sent you a confirmation link. Please check your email to verify your account before signing in.
          </p>

          <Link
            href="/auth/login"
            className="inline-block w-full py-3 px-4 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-xl transition-all text-center"
          >
            Back to login
          </Link>
        </div>
      </div>
    </div>
  )
}
