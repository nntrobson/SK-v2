"use client"

import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Target } from "lucide-react"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSignIn() {
    console.log("[v0] Sign in clicked", { email })
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      console.log("[v0] Calling supabase.auth.signInWithPassword")
      const { error, data } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      console.log("[v0] Sign in response:", { error, user: data?.user?.email })
      if (error) throw error
      console.log("[v0] Sign in successful, redirecting to dashboard")
      router.push("/dashboard")
    } catch (err) {
      console.log("[v0] Sign in error:", err)
      setError(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-xl p-8">
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Target className="w-8 h-8 text-orange-500" />
            <span className="text-2xl font-bold text-white">ShotVision</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Sign In</h1>
          <p className="text-slate-400 mt-2">Enter your credentials to access your account</p>
        </div>
        
        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}
          
          <div className="space-y-2">
            <label htmlFor="email" className="block text-sm font-medium text-slate-200">Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          
          <div className="space-y-2">
            <label htmlFor="password" className="block text-sm font-medium text-slate-200">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          
          <button 
            type="button"
            onClick={handleSignIn}
            className="w-full h-10 px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </div>
        
        <div className="mt-6 text-center text-sm text-slate-400">
          {"Don't have an account? "}
          <Link href="/auth/sign-up" className="text-orange-400 hover:text-orange-300 font-medium">
            Sign up
          </Link>
        </div>
      </div>
    </div>
  )
}
