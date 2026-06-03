import type { ReactNode } from "react";

type PageHeaderProps = {
  children: ReactNode;
};

export function PageHeader({ children }: PageHeaderProps) {
  return (
    <section className="border-b border-zinc-200 bg-[#161615] text-white">
      <div className="mx-auto flex min-h-[18rem] max-w-7xl flex-col justify-center px-5 py-6 sm:px-8 md:h-72 lg:px-10">
        {children}
      </div>
    </section>
  );
}
