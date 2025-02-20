# Chat

Chat example.

## Steps to run the project

1. Install prerequisites;
2. Clone the project;
3. Create the configuration;
4. Install NPM packages;
5. Run the project.

## Install prerequisites

Install:

- `Git`: Latest version.
- `Docker`: Latest version.
- `Visual Studio Code`: Latest version and install recommended extensions after cloning the project.

## Clone the project

Clone the project using HTTPS or SSH, preferably SSH.

## Create the configuration

Create a copy of the `.sample-env` file, rename it to `.env`, and follow the instructions in the file.

## Build Docker images

Run the command in the root folder:

```
docker-compose build
```

## Install NPM packages

Run the commands in the root folder:

Server:

```
docker-compose run --rm --no-deps server npm install
```

Client:

```
docker-compose run --rm --no-deps client npm install
```

## Run the project

Run the command in the root folder:

```
docker-compose up -d
```
