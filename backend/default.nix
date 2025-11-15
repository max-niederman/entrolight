{ python3, cudatoolkit, cudaPackages }:

python3.pkgs.buildPythonApplication {
  name = "entrolight-backend";

  src = ./.;
  format = "pyproject";

  buildInputs = [
    cudatoolkit
    cudaPackages.cuda_nvcc
  ];

  propagatedBuildInputs = with python3.pkgs; [
    fastapi
    vllm
  ];
}