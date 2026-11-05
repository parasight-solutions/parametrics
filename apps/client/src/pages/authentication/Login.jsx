import { LockKeyhole, Mail } from "lucide-react";

import { useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";

import FormField from "../../components/ui/FormField";
import FieldError from "../../components/ui/FieldError";
import CustomInput from "../../components/ui/CustomInput";
import CustomButton from "../../components/ui/CustomButton";
import CustomInputPassword from "../../components/ui/CustomInputPassword";

import { authEndpoints } from "../../services/auth.service";

import useApi from "../../hooks/useApi";

import { useAuth } from "../../context/auth/useAuth";

import { getLoginErrorMessage, getPostLoginPath } from "./loginHelpers";
import GoogleAuthButton from "../../components/GoogleAuthButton";

const Login = () => {
  const { login } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();

  const { loading, callApi } = useApi({ submitting: false });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    mode: "onChange",
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (values) =>
    callApi("submitting", () => authEndpoints.login(values), {
      onSuccess: ({ data }) => {
        if (!data?.user) {
          throw new Error("Invalid login response");
        }

        login(data.user);
        navigate(getPostLoginPath(location.state?.from), { replace: true });
      },
      onError: (error) => {
        setError("root.server", {
          type: "server",
          message: getLoginErrorMessage(error),
        });
      },
    });

  return (
    <main className="min-h-screen bg-[#F7F9FB] flex items-center justify-center p-6">
      <div className="w-full max-w-md p-7 flex flex-col gap-6 rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Sign in</h1>
          <p className="mt-1 text-sm text-gray-500">
            Enter your credentials to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField
            id="email"
            label="Email"
            required
            error={errors.email?.message}
          >
            <CustomInput
              id="email"
              type="email"
              autoComplete="username"
              placeholder="name@example.com"
              icon={Mail}
              disabled={loading.submitting}
              {...register("email", {
                required: "Email is required.",
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: "Enter a valid email address.",
                },
              })}
            />
          </FormField>

          <FormField
            id="password"
            label="Password"
            required
            error={errors.password?.message}
          >
            <CustomInputPassword
              id="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              icon={LockKeyhole}
              disabled={loading.submitting}
              {...register("password", {
                required: "Password is required.",
              })}
            />
          </FormField>

          <FieldError error={errors.root?.server?.message} />

          <CustomButton
            type="submit"
            name="Sign in"
            loading={loading.submitting}
            className="w-full"
          />
        </form>

        <div className="flex items-center gap-2">
          <div className="flex-1 border-b border-gray-400"></div>
          <span className="text-xs text-gray-500">OR</span>
          <div className="flex-1 border-b border-gray-400"></div>
        </div>

        <GoogleAuthButton />
      </div>
    </main>
  );
};

export default Login;
