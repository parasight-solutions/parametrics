import googleLogo from "../assets/google.svg";

const GoogleAuthButton = () => {
  return (
    <div
      className="p-2.5 flex items-center justify-between gap-3 text-sm
    hover:bg-gray-100 border border-gray-300
      rounded-full cursor-pointer transition-all duration-200"
    >
      <img src={googleLogo} alt="Google Logo" className="size-5" />
      <span className="w-full text-center">Continue with Google</span>
    </div>
  );
};

export default GoogleAuthButton;
