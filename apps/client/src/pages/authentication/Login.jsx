import { LockKeyhole, Mail } from "lucide-react";

import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";

import FormField from "../../components/ui/FormField";
import FieldError from "../../components/ui/FieldError";
import CustomInput from "../../components/ui/CustomInput";
import CustomButton from "../../components/ui/CustomButton";
import CustomInputPassword from "../../components/ui/CustomInputPassword";

import { authEndpoints } from "../../services/auth.service";

import useApi from "../../hooks/useApi";

import { useAuth } from "../../context/auth/useAuth";

import { getLoginErrorMessage, getPostLoginPath } from "./loginHelpers";

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
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-7 shadow-sm"
      >
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Sign in</h1>
          <p className="mt-1 text-sm text-gray-500">
            Enter your credentials to continue.
          </p>
        </div>

        <div className="space-y-4">
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
        </div>
      </form>
    </main>
  );
};

export default Login;
