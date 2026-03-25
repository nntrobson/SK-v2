import Link from 'next/link'
import { Target, AlertCircle } from 'lucide-react'

export default function AuthErrorPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="relative">
            <div className="absolute inset-0 bg-orange-500/20 rounded-full blur-xl" />
            <div className="relative bg-gradient-to-br from-orange-500 to-orange-600 p-3 rounded-2xl shadow-lg shadow-orange-500/25">
              <Target className="w-8 h-8 text-white" />
            </div>
          </div>
          <span className="text-2xl font-bold text-white tracking-tight">ShotTracker</span>
        </div>

        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 shadow-xl text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-red-500/20 p-3 rounded-full">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Authentication Error</h1>
          <p className="text-slate-400 mb-6">
            Something went wrong during authentication. Please try again.
          </p>
          <Link
            href="/auth/login"
            className="inline-block py-3 px-6 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-semibold rounded-xl shadow-lg shadow-orange-500/25 transition-all"
          >
            Back to login
          </Link>
        </div>
      </div>
    </div>
  )
}
